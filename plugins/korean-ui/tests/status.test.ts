import { expect, test, type Engine } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import {
  BUILTIN,
  BUNDLED,
  CLEAR_EN,
  GUIDE,
  HELP_EN,
  MODEL_EN,
  OTHER,
  OTHER_EN,
  OTHER_KO,
  VERSION,
  describeCommand,
  describeConfig,
  setupWorld,
} from './helpers.ts'

// /korean-ui-status 명령어를 실행합니다.
function status($: Engine) {
  return $.command.run({ command: 'korean-ui-status', args: '' })
}

const HEADER = ['| 제공자 | 문구 | 기본 번역표 | 자동 번역 | 고친 번역 | 미번역 | 건너뜀 |', '|---|---|---|---|---|---|---|']
const SETTINGS_DEFAULT = '설정: 기본 항목 번역 켜짐, 다른 플러그인과 스킬 번역 꺼짐, 미번역 알림 켜짐'

test('제공자별 번역 현황과 설정을 표시하고 Haiku를 호출하지 않습니다', { options: { translate_others: true } }, async ($, on) => {
  const world = setupWorld(on, {
    store: {
      dictionary: { commands: { [OTHER_EN]: OTHER_KO, Unseen: '확인하지 못한 문구' }, config: {} },
      overrides: { commands: { [MODEL_EN]: '모델을 고릅니다', Unseen: '확인하지 못한 문구' }, config: {} },
      failures: { version: VERSION, counts: { 'commands:Skipped command': 3 } },
    },
  })
  await describeCommand($, HELP_EN)
  await describeCommand($, `${MODEL_EN} (currently Opus 5.5)`, BUILTIN, 'model')
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeConfig($, 'Theme')
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, 'Skipped command', OTHER, 'skipped')
  expect((await status($)).text).toBe(
    [
      `버전: ${VERSION}`,
      '설정: 기본 항목 번역 켜짐, 다른 플러그인과 스킬 번역 켜짐, 미번역 알림 켜짐',
      '',
      ...HEADER,
      '| claude-code | 4 | 2 | 0 | 1 | 1 | 0 |',
      '| other-plugin | 2 | 0 | 1 | 0 | 0 | 1 |',
      '',
      '이번 세션에서 확인하지 못한 저장 번역: 1개',
    ].join('\n'),
  )
  expect(world.prompts).toEqual([])
})

test('여러 제공자가 쓰는 원문은 각 제공자의 행에 모두 세고, 확인하지 못한 저장 번역이 없으면 그 줄을 생략합니다', async ($, on) => {
  setupWorld(on)
  await describeCommand($, HELP_EN)
  await describeCommand($, HELP_EN, OTHER, 'other-help')
  expect((await status($)).text).toBe(
    [
      `버전: ${VERSION}`,
      SETTINGS_DEFAULT,
      '',
      ...HEADER,
      '| claude-code | 1 | 1 | 0 | 0 | 0 | 0 |',
      '| other-plugin | 1 | 1 | 0 | 0 | 0 | 0 |',
    ].join('\n'),
  )
})

test('설정을 꺼 두면 꺼짐으로 표시합니다', { options: { translate_builtin: false, notify_untranslated: false } }, async ($, on) => {
  setupWorld(on)
  const lines = ((await status($)).text ?? '').split('\n')
  expect(lines[1]).toBe('설정: 기본 항목 번역 꺼짐, 다른 플러그인과 스킬 번역 꺼짐, 미번역 알림 꺼짐')
})

test('확인한 문구가 없으면 표 대신 안내를 표시합니다', async ($, on) => {
  setupWorld(on)
  expect((await status($)).text).toBe([`버전: ${VERSION}`, SETTINGS_DEFAULT, '', MESSAGES.statusNothingSeen].join('\n'))
})

test('플러그인 버전을 읽지 못하면 버전을 알 수 없다고 표시하고 건너뜀을 0으로 셉니다', async ($, on) => {
  setupWorld(on, {
    files: { 'locales/ko.json': BUNDLED, 'locales/ko-guide.md': GUIDE },
    store: { failures: { version: VERSION, counts: { [`commands:${CLEAR_EN}`]: 3 } } },
  })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  const lines = ((await status($)).text ?? '').split('\n')
  expect(lines[0]).toBe('버전: 알 수 없음')
  expect(lines.at(-1)).toBe('| claude-code | 1 | 0 | 0 | 0 | 1 | 0 |')
})

test('3번 실패한 문구는 미번역이 아니라 건너뜀으로 셉니다', async ($, on) => {
  setupWorld(on, { store: { failures: { version: VERSION, counts: { [`commands:${CLEAR_EN}`]: 3 } } } })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  const lines = ((await status($)).text ?? '').split('\n')
  expect(lines.at(-1)).toBe('| claude-code | 1 | 0 | 0 | 0 | 0 | 1 |')
})
