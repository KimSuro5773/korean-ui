import { expect, test } from 'claude-code/testing'
import {
  BUILTIN,
  CLEAR_EN,
  HELP_EN,
  HELP_KO,
  MODEL_EN,
  MODEL_KO,
  OTHER,
  OTHER_EN,
  OTHER_KO,
  SELF,
  describeCommand,
  describeConfig,
  sendListing,
  setupWorld,
  startSession,
} from './helpers.ts'

const OTHER_DICTIONARY = { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } }

test('기본 명령어의 설명을 기본 번역표로 번역합니다', async ($, on) => {
  setupWorld(on)
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
})

test('번역문이 없는 기본 명령어는 원문을 그대로 둡니다', async ($, on) => {
  setupWorld(on)
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe(CLEAR_EN)
})

test('인자 힌트와 숨김 여부는 바꾸지 않습니다', async ($, on) => {
  setupWorld(on)
  const result = await $.command.describe({
    command: 'help',
    description: HELP_EN,
    argumentHint: '[topic]',
    isHidden: true,
    immediate: false,
    provider: BUILTIN,
  })
  expect(result).toEqual({ description: HELP_KO, argumentHint: '[topic]', isHidden: true })
})

test('기본 항목 번역을 끄면 기본 명령어를 번역하지 않습니다', { options: { translate_builtin: false } }, async ($, on) => {
  setupWorld(on)
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_EN)
})

test('다른 플러그인과 스킬 번역은 기본값이 꺼짐이라 번역하지 않습니다', async ($, on) => {
  setupWorld(on, { store: OTHER_DICTIONARY })
  expect((await describeCommand($, OTHER_EN, OTHER, 'deploy')).description).toBe(OTHER_EN)
})

test('다른 플러그인과 스킬 번역을 켜면 사용자 번역 사전으로 번역합니다', { options: { translate_others: true } }, async ($, on) => {
  setupWorld(on, { store: OTHER_DICTIONARY })
  expect((await describeCommand($, OTHER_EN, OTHER, 'deploy')).description).toBe(OTHER_KO)
})

test('두 사전에 같은 원문이 있으면 기본 번역표를 사용합니다', async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { [HELP_EN]: '사용자 사전의 번역' }, config: {} } } })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
})

test('이 플러그인 자신의 항목은 번역하지 않습니다', { options: { translate_others: true } }, async ($, on) => {
  setupWorld(on, { store: OTHER_DICTIONARY })
  expect((await describeCommand($, OTHER_EN, SELF, 'korean-ui-translate')).description).toBe(OTHER_EN)
})

test('기본 번역표를 읽지 못해도 사용자 번역 사전은 사용합니다', async ($, on) => {
  setupWorld(on, {
    files: { 'locales/ko.json': null },
    store: { dictionary: { commands: { [CLEAR_EN]: '사용자 사전의 번역' }, config: {} } },
  })
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe('사용자 사전의 번역')
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_EN)
})

test('/config 기본 항목의 이름을 번역합니다', async ($, on) => {
  setupWorld(on)
  expect((await describeConfig($, 'Theme')).label).toBe('테마')
})

test('다른 플러그인의 /config 항목은 이름과 도움말을 함께 번역합니다', { options: { translate_others: true } }, async ($, on) => {
  setupWorld(on, {
    store: { dictionary: { commands: {}, config: { 'API endpoint': 'API 엔드포인트', "Your team's API endpoint": '팀의 API 엔드포인트' } } },
  })
  const result = await describeConfig($, 'API endpoint', OTHER, 'other-plugin.api_endpoint', "Your team's API endpoint")
  expect(result).toEqual({ label: 'API 엔드포인트', description: '팀의 API 엔드포인트', isHidden: false })
})

test('세션이 시작되면 다음 처리로 넘깁니다', async ($, on) => {
  setupWorld(on)
  expect(await startSession($)).toEqual({ cwd: '/work' })
})

test('설명 끝의 (currently …)는 떼어 내고 번역한 뒤 (현재 …)로 붙입니다', async ($, on) => {
  setupWorld(on)
  const result = await describeCommand($, `${MODEL_EN} (currently Opus 5.5)`, BUILTIN, 'model')
  expect(result.description).toBe(`${MODEL_KO}(현재 Opus 5.5)`)
})

test('Claude에게 보내는 스킬 목록에서는 번역문을 영어 원문으로 되돌립니다', async ($, on) => {
  setupWorld(on)
  const result = await sendListing($, `- help: ${HELP_KO}\n- model: ${MODEL_KO}(현재 Opus 5.5)\n- other: Other skill`)
  expect(result.text).toBe(`- help: ${HELP_EN}\n- model: ${MODEL_EN} (currently Opus 5.5)\n- other: Other skill`)
})

test('번역을 끈 뒤에도 스킬 목록에 남은 번역문을 되돌립니다', { options: { translate_builtin: false } }, async ($, on) => {
  setupWorld(on)
  expect((await sendListing($, `- help: ${HELP_KO}`)).text).toBe(`- help: ${HELP_EN}`)
})

test(
  '다른 명령어와 번역문이 같아도 스킬 목록에서는 그 명령어의 원문으로 되돌립니다',
  { options: { translate_others: true } },
  async ($, on) => {
    setupWorld(on, { store: { dictionary: { commands: { [OTHER_EN]: HELP_KO }, config: {} } } })
    await describeCommand($, HELP_EN)
    await describeCommand($, OTHER_EN, OTHER, 'deploy')
    const result = await sendListing($, `- help: ${HELP_KO}\n- deploy: ${HELP_KO}`)
    expect(result.text).toBe(`- help: ${HELP_EN}\n- deploy: ${OTHER_EN}`)
  },
)

test('번역문이 없으면 스킬 목록을 그대로 보냅니다', async ($, on) => {
  setupWorld(on)
  const text = `- clear: ${CLEAR_EN}`
  expect((await sendListing($, text)).text).toBe(text)
})
