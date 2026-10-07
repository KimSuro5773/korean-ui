import { expect, test } from 'claude-code/testing'
import {
  MESSAGES,
  buildExport,
  categoryOf,
  emptySeen,
  failedListText,
  failureReason,
  isEnabled,
  lookup,
  makeBatches,
  needsTranslation,
  noticeKey,
  parseDictionary,
  readSettings,
  recordSeen,
  splitState,
  summaryText,
  untranslated,
  withOthersHint,
  withState,
  withTranslations,
} from '../hooks/lib/translation.ts'

const DEFAULTS = { translateBuiltin: true, translateOthers: false, notifyUntranslated: true }
const ON_ALL = { translateBuiltin: true, translateOthers: true, notifyUntranslated: true }
const EMPTY = { commands: {}, config: {} }

test('readSettings는 값이 없으면 plugin.json의 기본값을 사용합니다', () => {
  expect(readSettings({})).toEqual(DEFAULTS)
  expect(readSettings({ translate_builtin: false, translate_others: true, notify_untranslated: false })).toEqual({
    translateBuiltin: false,
    translateOthers: true,
    notifyUntranslated: false,
  })
})

test('parseDictionary는 형식이 잘못된 항목을 버립니다', () => {
  expect(parseDictionary(undefined)).toEqual(EMPTY)
  expect(parseDictionary('text')).toEqual(EMPTY)
  expect(parseDictionary({ commands: { A: '가', B: 3, C: '  ' }, config: ['x'] })).toEqual({ commands: { A: '가' }, config: {} })
})

test('categoryOf는 제공자로 범주를 정하고 @ 뒤의 마켓플레이스 이름은 무시합니다', () => {
  expect(categoryOf('engine', 'korean-ui')).toBe('builtin')
  expect(categoryOf('korean-ui', 'korean-ui')).toBe('self')
  expect(categoryOf('korean-ui@korean-ui', 'korean-ui')).toBe('self')
  expect(categoryOf('korean-ui@inline', 'korean-ui@inline')).toBe('self')
  expect(categoryOf('other-plugin@market', 'korean-ui')).toBe('others')
})

test('splitState는 설명 끝의 (currently …)만 떼어 냅니다', () => {
  expect(splitState('Set the AI model for Claude Code (currently Opus 5.5)')).toEqual({
    base: 'Set the AI model for Claude Code',
    state: 'Opus 5.5',
  })
  expect(splitState('Show help')).toEqual({ base: 'Show help', state: undefined })
  expect(splitState('Resume (resumable with /resume)')).toEqual({ base: 'Resume (resumable with /resume)', state: undefined })
})

test('withState는 번역문 뒤에 (현재 …)를 붙입니다', () => {
  expect(withState('Claude Code의 AI 모델을 설정합니다', 'Opus 5.5')).toBe('Claude Code의 AI 모델을 설정합니다(현재 Opus 5.5)')
  expect(withState('도움말을 표시합니다', undefined)).toBe('도움말을 표시합니다')
})

test('isEnabled는 범주별 설정을 따르고 self는 항상 끕니다', () => {
  expect(isEnabled('builtin', DEFAULTS)).toBe(true)
  expect(isEnabled('others', DEFAULTS)).toBe(false)
  expect(isEnabled('others', ON_ALL)).toBe(true)
  expect(isEnabled('self', ON_ALL)).toBe(false)
})

test('needsTranslation은 빈 문구와 한글이 든 문구를 제외합니다', () => {
  expect(needsTranslation('Show help')).toBe(true)
  expect(needsTranslation('')).toBe(false)
  expect(needsTranslation('   ')).toBe(false)
  expect(needsTranslation('직접 만든 스킬입니다')).toBe(false)
  expect(needsTranslation('Deploy 스킬')).toBe(false)
  expect(needsTranslation('Use ㅋ')).toBe(false)
})

test('needsTranslation은 여러 줄로 된 문구를 제외합니다', () => {
  expect(needsTranslation('Reference for the API.\nTRIGGER when asked.')).toBe(false)
  expect(needsTranslation('Line one\r\nLine two')).toBe(false)
})

test('lookup은 기본 번역표를 먼저 찾고 객체의 기본 속성은 무시합니다', () => {
  const bundled = { commands: { A: '기본' }, config: {} }
  const user = { commands: { A: '사용자', B: '사용자 B' }, config: {} }
  expect(lookup(bundled, user, 'commands', 'A')).toBe('기본')
  expect(lookup(bundled, user, 'commands', 'B')).toBe('사용자 B')
  expect(lookup(bundled, user, 'commands', 'C')).toBeUndefined()
  expect(lookup(bundled, user, 'commands', 'constructor')).toBeUndefined()
  expect(lookup(bundled, user, 'config', 'A')).toBeUndefined()
})

test('recordSeen은 같은 원문이 기본 항목으로 한 번이라도 나오면 기본 항목으로 기록합니다', () => {
  const seen = emptySeen()
  recordSeen(seen, 'commands', 'A', 'others')
  recordSeen(seen, 'commands', 'A', 'builtin')
  recordSeen(seen, 'commands', 'A', 'others')
  expect(seen.commands.get('A')).toBe('builtin')
})

test('untranslated는 켜진 범주에서 번역문이 없는 원문만 정렬해서 돌려줍니다', () => {
  const seen = emptySeen()
  recordSeen(seen, 'commands', 'Zeta', 'builtin')
  recordSeen(seen, 'commands', 'Alpha', 'builtin')
  recordSeen(seen, 'commands', 'Known', 'builtin')
  recordSeen(seen, 'commands', 'Other', 'others')
  recordSeen(seen, 'config', 'Theme', 'builtin')
  const bundled = { commands: { Known: '알려진 문구' }, config: {} }
  expect(untranslated(seen, DEFAULTS, bundled, EMPTY)).toEqual({ commands: ['Alpha', 'Zeta'], config: ['Theme'] })
  expect(untranslated(seen, ON_ALL, bundled, EMPTY).commands).toEqual(['Alpha', 'Other', 'Zeta'])
})

test('makeBatches는 50개마다 나눕니다', () => {
  const items = Array.from({ length: 120 }, (_, i) => `item ${i}`)
  expect(makeBatches(items).map((batch) => batch.length)).toEqual([50, 50, 20])
})

test('makeBatches는 원문 글자 수 합계가 6000자를 넘지 않게 나눕니다', () => {
  const long = (letter: string) => letter.repeat(2500)
  expect(makeBatches([long('a'), long('b'), long('c')]).map((batch) => batch.length)).toEqual([2, 1])
  expect(makeBatches(['x'.repeat(7000), 'short']).map((batch) => batch.length)).toEqual([1, 1])
  expect(makeBatches([])).toEqual([])
})

test('withTranslations는 기존 번역을 유지하고 새 번역을 더하며 원래 사전을 바꾸지 않습니다', () => {
  const before = { commands: { A: '가' }, config: { T: '테' } }
  expect(withTranslations(before, 'commands', { B: '나' })).toEqual({ commands: { A: '가', B: '나' }, config: { T: '테' } })
  expect(before).toEqual({ commands: { A: '가' }, config: { T: '테' } })
})

test('buildExport는 기존 기본 번역표를 모두 남기고, 확인한 기본 항목의 새 번역을 더해 정렬합니다', () => {
  const seen = emptySeen()
  recordSeen(seen, 'commands', 'Zeta', 'builtin')
  recordSeen(seen, 'commands', 'Alpha', 'builtin')
  recordSeen(seen, 'commands', 'Missing', 'builtin')
  recordSeen(seen, 'commands', 'Other', 'others')
  recordSeen(seen, 'config', 'Theme', 'builtin')
  // Conditional은 이번에 화면에 보이지 않은 기본 항목입니다. 기존 번역표에 있으므로 그대로 남아야 합니다.
  const bundled = { commands: { Zeta: '제타', Conditional: '조건부' }, config: { Theme: '테마' } }
  const user = { commands: { Alpha: '알파', Other: '다른 것' }, config: {} }
  const result = buildExport(seen, bundled, user)
  expect(result.missing).toBe(1)
  expect(result.builtinCount).toBe(4)
  expect(result.json).toBe(
    `${JSON.stringify({ commands: { Alpha: '알파', Conditional: '조건부', Zeta: '제타' }, config: { Theme: '테마' } }, null, 2)}\n`,
  )
})

test('summaryText는 실패한 문구가 있을 때만 재시도 안내를 붙입니다', () => {
  expect(summaryText({ commands: 2, config: 1, failed: 0 })).toBe('명령어 설명 2개, 설정 항목 1개를 번역했습니다.')
  expect(summaryText({ commands: 0, config: 0, failed: 3 })).toBe(
    '명령어 설명 0개, 설정 항목 0개를 번역했습니다. 실패한 3개는 다음에 실행할 때 다시 번역합니다.',
  )
})

test('withOthersHint는 다른 플러그인과 스킬의 번역이 꺼져 있을 때만 안내를 덧붙입니다', () => {
  expect(withOthersHint('완료.', DEFAULTS)).toBe(`완료. ${MESSAGES.othersHint}`)
  expect(withOthersHint('완료.', ON_ALL)).toBe('완료.')
})

test('failureReason은 모델 실패 원인을 한국어로 바꿉니다', () => {
  expect(failureReason('api-error', 529)).toBe('API 오류(상태 코드 529)')
  expect(failureReason('api-error', null)).toBe('API 오류(상태 코드 없음)')
  expect(failureReason('aborted', undefined)).toBe('호출이 중단됨')
})

test('failedListText는 실패한 원문을 한 줄에 하나씩 보여 주고 긴 원문은 80자에서 줄입니다', () => {
  expect(failedListText([])).toBe('')
  expect(failedListText(['Toggle the diff panel', 'Exit the CLI'])).toBe('\n실패한 문구:\n- Toggle the diff panel\n- Exit the CLI')
  expect(failedListText(['a'.repeat(100)])).toBe(`\n실패한 문구:\n- ${'a'.repeat(80)}…`)
})

test('noticeKey는 종류와 원문을 함께 씁니다', () => {
  expect(noticeKey('config', 'Theme')).toBe('config:Theme')
})
