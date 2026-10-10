import { expect, test } from 'claude-code/testing'
import {
  SELECTION_GUIDE,
  buildSelectionPrompt,
  candidatesOf,
  confirmQuestion,
  displayName,
  parseSelection,
  requestResultText,
  selectionChunks,
  type Candidate,
} from '../hooks/lib/request.ts'
import { emptySeen, recordSeen } from '../hooks/lib/translation.ts'

const EMPTY = { commands: {}, config: {} }
const ON_ALL = { translateBuiltin: true, translateOthers: true, notifyUntranslated: true }
const BUILTIN_ONLY = { translateBuiltin: true, translateOthers: false, notifyUntranslated: true }

// 명령어 설명 후보 하나를 만듭니다. 이름은 원문을 소문자로 바꾼 '/이름'입니다.
const candidate = (source: string, extra: Partial<Candidate> = {}): Candidate => ({
  kind: 'commands',
  source,
  names: [`/${source.toLowerCase()}`],
  providers: ['claude-code'],
  ...extra,
})

test('candidatesOf는 켜 둔 범주의 모든 원문을 종류와 원문순으로 돌려주고, 번역문이 있으면 함께 담습니다', () => {
  const seen = emptySeen()
  recordSeen(seen, 'config', 'Theme', 'builtin', 'theme', 'claude-code')
  recordSeen(seen, 'commands', 'Zeta', 'builtin', '/zeta', 'claude-code')
  recordSeen(seen, 'commands', 'Alpha', 'builtin', '/alpha', 'claude-code')
  recordSeen(seen, 'commands', 'Other', 'others', '/other', 'other-plugin')
  const layers = {
    overrides: { commands: { Zeta: '고친 제타' }, config: {} },
    bundled: { commands: { Zeta: '제타' }, config: { Theme: '테마' } },
    user: EMPTY,
  }
  expect(candidatesOf(seen, BUILTIN_ONLY, layers)).toEqual([
    { kind: 'commands', source: 'Alpha', names: ['/alpha'], providers: ['claude-code'] },
    { kind: 'commands', source: 'Zeta', names: ['/zeta'], providers: ['claude-code'], current: '고친 제타' },
    { kind: 'config', source: 'Theme', names: ['theme'], providers: ['claude-code'], current: '테마' },
  ])
  expect(candidatesOf(seen, ON_ALL, layers).map((item) => item.source)).toEqual(['Alpha', 'Other', 'Zeta', 'Theme'])
})

test('selectionChunks는 200개씩 나눕니다', () => {
  const many = Array.from({ length: 401 }, (_, i) => candidate(`C${i}`))
  expect(selectionChunks(many).map((chunk) => chunk.length)).toEqual([200, 200, 1])
  expect(selectionChunks([])).toEqual([])
})

test('buildSelectionPrompt는 요청과 항목을 한 줄에 하나씩 담습니다', () => {
  const request = '"/commit" 설명을 `짧게` 고쳐 줘'
  const prompt = buildSelectionPrompt(request, [
    candidate('Commit', { names: ['/commit'], current: '커밋합니다' }),
    { kind: 'config', source: 'Theme', names: ['theme'], providers: ['claude-code'] },
  ])
  const lines = prompt.split('\n')
  expect(lines[0]).toBe(`사용자 요청: ${request}`)
  expect(lines.length).toBe(5)
  expect(JSON.parse(lines.at(-2) ?? '')).toEqual({
    id: '1',
    kind: '명령어',
    name: '/commit',
    plugin: 'claude-code',
    text: 'Commit',
    status: '번역됨',
    current: '커밋합니다',
  })
  expect(JSON.parse(lines.at(-1) ?? '')).toEqual({
    id: '2',
    kind: '설정',
    name: 'theme',
    plugin: 'claude-code',
    text: 'Theme',
    status: '미번역',
  })
})

test('buildSelectionPrompt는 이름과 제공자를 3개까지만 넣습니다', () => {
  const prompt = buildSelectionPrompt('고쳐 줘', [candidate('Shared', { names: ['/a', '/b', '/c', '/d'], providers: ['p1', 'p2', 'p3', 'p4'] })])
  expect(JSON.parse(prompt.split('\n').at(-1) ?? '')).toEqual({
    id: '1',
    kind: '명령어',
    name: '/a, /b, /c',
    plugin: 'p1, p2, p3',
    text: 'Shared',
    status: '미번역',
  })
})

test('SELECTION_GUIDE는 고르는 기준과 응답 형식을 담습니다', () => {
  expect(SELECTION_GUIDE).toContain('요청이 대상을 한정하지 않고 번역 방식만 말하면 status가 "미번역"인 항목만 고릅니다.')
  expect(SELECTION_GUIDE).toContain('status가 "번역됨"인 항목은 요청이 고치거나 다시 번역하라는 뜻일 때만 고릅니다.')
  expect(SELECTION_GUIDE).toContain('{"targets": ["1", "5"]}')
})

test('parseSelection은 유효한 id만 목록 순서로 한 번씩 고릅니다', () => {
  const chunk = [candidate('A'), candidate('B'), candidate('C')]
  expect(parseSelection(chunk, '{"targets": ["3", 1, "1", "99", "0", "x", null, 1.5]}')).toEqual([chunk[0], chunk[2]])
  expect(parseSelection(chunk, '```json\n{"targets": []}\n```')).toEqual([])
})

test('parseSelection은 읽을 수 없는 응답이면 undefined를 돌려줍니다', () => {
  const chunk = [candidate('A')]
  expect(parseSelection(chunk, '죄송합니다')).toBeUndefined()
  expect(parseSelection(chunk, '{"targets": "1"}')).toBeUndefined()
  expect(parseSelection(chunk, '{"1": "가"}')).toBeUndefined()
})

test('confirmQuestion은 다시 번역할 수와 새로 번역할 수, 대상 이름 5개까지를 보여 줍니다', () => {
  const targets = ['A', 'B', 'C', 'D', 'E', 'F'].map((source) => candidate(source, { current: '번역' }))
  expect(confirmQuestion(targets)).toBe('기존 번역 6개를 다시 번역합니다: /a, /b, /c, /d, /e 외 1개. 진행할까요?')
  expect(confirmQuestion([candidate('A', { current: '번역' }), candidate('B')])).toBe(
    '기존 번역 1개를 다시 번역하고, 미번역 문구 1개를 번역합니다: /a, /b. 진행할까요?',
  )
})

test('displayName은 이름이 없으면 원문의 앞 30자를 씁니다', () => {
  expect(displayName(candidate('A'))).toBe('/a')
  expect(displayName({ kind: 'commands', source: 'x'.repeat(40), names: [], providers: [] })).toBe('x'.repeat(30))
})

test('requestResultText는 바뀐 문구를 20줄까지 보여 주고 그대로인 수와 실패한 수를 알려 줍니다', () => {
  expect(
    requestResultText(
      { commands: 2, config: 0 },
      [
        { name: '/a', before: '가', after: '나' },
        { name: '/b', after: '다' },
      ],
      0,
      0,
    ),
  ).toBe('요청에 따라 명령어 설명 2개, 설정 항목 0개를 번역했습니다.\n- /a: 가 → 나\n- /b: 다')
  const many = Array.from({ length: 22 }, (_, i) => ({ name: `/c${i}`, after: '번역' }))
  const text = requestResultText({ commands: 22, config: 0 }, many, 1, 2)
  expect(text.split('\n')[0]).toBe(
    '요청에 따라 명령어 설명 22개, 설정 항목 0개를 번역했습니다. 번역문이 그대로인 문구 1개는 저장하지 않았습니다. 실패한 2개는 바꾸지 않았습니다.',
  )
  expect(text.split('\n').length).toBe(22)
  expect(text.endsWith('- 외 2개')).toBe(true)
})
