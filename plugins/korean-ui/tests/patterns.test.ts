import { expect, test } from 'claude-code/testing'
import { matchPattern, parsePatterns } from '../hooks/lib/patterns'
import { buildExport, emptySeen, lookup, recordSeen, untranslated } from '../hooks/lib/translation'
import {
  BUILTIN,
  GUIDE,
  PLUGIN_JSON,
  VERSION,
  describeCommand,
  describeConfig,
  runCommand,
  sendListing,
  setupWorld,
} from './helpers'

const FAST_EN = 'Toggle fast mode (Sonnet 5.5)'
const FAST_KO = '빠른 모드를 켜거나 끕니다(Sonnet 5.5)'
const FAST_PATTERN = { 'Toggle fast mode ({model})': '빠른 모드를 켜거나 끕니다({model})' }
const EMPTY = { commands: {}, config: {} }
const DEFAULTS = { translateBuiltin: true, translateOthers: false, notifyUntranslated: true }

// 패턴 섹션이 든 기본 번역표로 시험용 파일 묶음을 만듭니다.
function filesWith(bundled: Record<string, unknown>) {
  return { 'locales/ko.json': JSON.stringify(bundled), 'locales/ko-guide.md': GUIDE, '.claude-plugin/plugin.json': PLUGIN_JSON }
}

// 원문 패턴과 번역문 목록으로 패턴 표를 만듭니다.
function tableOf(commands: Record<string, unknown>, config: Record<string, unknown> = {}) {
  return parsePatterns({ patterns: { commands, config } }).table
}

test('parsePatterns는 규칙에 맞는 패턴만 읽고 버린 원문을 알려 줍니다', () => {
  const { table, dropped } = parsePatterns({
    patterns: {
      commands: {
        ...FAST_PATTERN,
        Plain: '평문',
        'A ({x})': '가({y})',
        'A {x} {x}': '가 {x}',
        'C ({x})': '다({x}{x})',
        'B ({x})': 3,
      },
      config: { 'Fast mode ({model})': '빠른 모드({model})' },
    },
  })
  expect(table.commands.map((pattern) => pattern.source)).toEqual(['Toggle fast mode ({model})'])
  expect(table.config.map((pattern) => pattern.source)).toEqual(['Fast mode ({model})'])
  expect(dropped).toEqual(['Plain', 'A ({x})', 'A {x} {x}', 'C ({x})', 'B ({x})'])
  expect(parsePatterns({ commands: {} })).toEqual({ table: { commands: [], config: [] }, dropped: [] })
})

test('matchPattern은 원문의 특수 문자를 글자 그대로 비교하고 원문 전체가 맞아야 합니다', () => {
  const table = tableOf({ 'Start ({time}, {cost} USD) · See https://x.y/z': '시작({time}, {cost} USD) · https://x.y/z' })
  expect(matchPattern(table.commands, 'Start (~5-15 min, $5-$25 USD) · See https://x.y/z')).toBe(
    '시작(~5-15 min, $5-$25 USD) · https://x.y/z',
  )
  expect(matchPattern(table.commands, 'Start (~5-15 min, $5-$25 USD) · See https://x.y/z extra')).toBeUndefined()
  expect(matchPattern(table.commands, 'Start (~5-15 min, $5-$25 USD) · See https://xay/z')).toBeUndefined()
})

test('matchPattern은 짧은 패턴을 더 긴 상태 문구에 맞추지 않습니다', () => {
  const table = tableOf({ '{icon} sandbox enabled (⏎ to configure)': '{icon} 샌드박스 활성화됨(⏎를 눌러 설정)' })
  expect(matchPattern(table.commands, '✓ sandbox enabled (auto-allow) (⏎ to configure)')).toBeUndefined()
  expect(matchPattern(table.commands, '✓ sandbox enabled (⏎ to configure)')).toBe('✓ 샌드박스 활성화됨(⏎를 눌러 설정)')
})

test('lookup은 고친 번역, 같은 문구의 기본 번역, 패턴, 자동 번역 순서로 찾습니다', () => {
  const patterns = tableOf(FAST_PATTERN)
  const overrides = { commands: { [FAST_EN]: '고친 번역' }, config: {} }
  const bundled = { commands: { [FAST_EN]: '같은 문구의 기본 번역' }, config: {} }
  const user = { commands: { [FAST_EN]: '자동 번역' }, config: {} }
  expect(lookup({ overrides, bundled, user, patterns }, 'commands', FAST_EN)).toBe('고친 번역')
  expect(lookup({ overrides: EMPTY, bundled, user, patterns }, 'commands', FAST_EN)).toBe('같은 문구의 기본 번역')
  expect(lookup({ overrides: EMPTY, bundled: EMPTY, user, patterns }, 'commands', FAST_EN)).toBe(FAST_KO)
  expect(lookup({ overrides: EMPTY, bundled: EMPTY, user }, 'commands', FAST_EN)).toBe('자동 번역')
})

test('메뉴와 /config에 패턴으로 찾은 번역을 표시합니다', async ($, on) => {
  setupWorld(on, {
    files: filesWith({ ...EMPTY, patterns: { commands: FAST_PATTERN, config: { 'Fast mode ({model})': '빠른 모드({model})' } } }),
  })
  expect((await describeCommand($, FAST_EN, BUILTIN, 'fast')).description).toBe(FAST_KO)
  expect((await describeConfig($, 'Fast mode (Sonnet 5.5)', BUILTIN, 'fastMode')).label).toBe('빠른 모드(Sonnet 5.5)')
})

test('패턴은 (currently …)를 떼어 낸 원문에 맞추고 (현재 …)를 다시 붙입니다', async ($, on) => {
  setupWorld(on, { files: filesWith({ ...EMPTY, patterns: { commands: { 'Switch thing ({x})': '전환({x})' }, config: {} } }) })
  expect((await describeCommand($, 'Switch thing (A) (currently B)', BUILTIN, 'switch')).description).toBe('전환(A)(현재 B)')
})

test('패턴에 맞은 원문은 미번역으로 세지 않고 현황에서 기본 번역표로 셉니다', async ($, on) => {
  const seen = emptySeen()
  recordSeen(seen, 'commands', FAST_EN, 'builtin', '/fast', 'claude-code')
  recordSeen(seen, 'commands', 'Other', 'builtin', '/other', 'claude-code')
  const layers = { overrides: EMPTY, bundled: EMPTY, user: EMPTY, patterns: tableOf(FAST_PATTERN) }
  expect(untranslated(seen, DEFAULTS, layers).commands).toEqual(['Other'])

  const world = setupWorld(on, { files: filesWith({ ...EMPTY, patterns: { commands: FAST_PATTERN, config: {} } }) })
  await describeCommand($, FAST_EN, BUILTIN, 'fast')
  const text = (await runCommand($, 'korean-ui-status')).text
  expect(text).toContain(`버전: ${VERSION}`)
  expect(text).toContain('| claude-code | 1 | 1 | 0 | 0 | 0 | 0 |')
  expect(world.prompts).toEqual([])
})

test('내보내기는 패턴 섹션을 넣고 패턴에 맞은 원문은 항목으로 추가하지 않습니다', () => {
  const seen = emptySeen()
  recordSeen(seen, 'commands', 'Zeta', 'builtin', '/zeta', 'claude-code')
  recordSeen(seen, 'commands', FAST_EN, 'builtin', '/fast', 'claude-code')
  const bundled = { commands: { Zeta: '제타' }, config: {} }
  const result = buildExport(seen, { overrides: EMPTY, bundled, user: EMPTY, patterns: tableOf(FAST_PATTERN) })
  expect(result.missing).toBe(0)
  expect(result.builtinCount).toBe(2)
  expect(result.json).toBe(
    `${JSON.stringify({ commands: { Zeta: '제타' }, config: {}, patterns: { commands: FAST_PATTERN, config: {} } }, null, 2)}\n`,
  )
})

test('스킬 목록에서 패턴으로 번역한 설명도 영어 원문으로 되돌립니다', async ($, on) => {
  const world = setupWorld(on, { files: filesWith({ ...EMPTY, patterns: { commands: FAST_PATTERN, config: {} } }) })
  await describeCommand($, FAST_EN, BUILTIN, 'fast')
  expect((await sendListing($, `- fast: ${FAST_KO} - 빠르게 답할 때`)).text).toBe(`- fast: ${FAST_EN} - 빠르게 답할 때`)
  // 명령어 이름별 표의 패턴 번역으로 되돌려야 하고, 이름으로 되돌리기(마지막 단계)에 기대면 안 됩니다.
  expect(world.logs).toContain('스킬 목록에서 설명 1줄을 영어 원문으로 되돌렸습니다(명령어 이름으로 찾은 줄 1개, 사전 전체에서 찾은 줄 0개).')
})

test('규칙에 맞지 않는 패턴은 디버그 로그에 남기고 나머지 번역은 그대로 씁니다', async ($, on) => {
  const world = setupWorld(on, {
    files: filesWith({ ...EMPTY, patterns: { commands: { ...FAST_PATTERN, Plain: '평문' }, config: {} } }),
  })
  expect((await describeCommand($, FAST_EN, BUILTIN, 'fast')).description).toBe(FAST_KO)
  expect(world.logs).toContain('기본 번역표의 패턴 1개를 규칙에 맞지 않아 버렸습니다: Plain')
})
