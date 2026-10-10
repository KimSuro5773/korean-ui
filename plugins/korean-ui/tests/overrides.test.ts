import { expect, test } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import { BUILTIN, CLEAR_EN, CLEAR_KO, HELP_EN, HELP_KO, describeCommand, sendListing, setupWorld } from './helpers.ts'

const HELP_FIXED = '도움말을 봅니다'
const FIXED = { overrides: { commands: { [HELP_EN]: HELP_FIXED }, config: {} } }

test('고친 번역은 기본 번역표보다 먼저 표시합니다', async ($, on) => {
  setupWorld(on, { store: FIXED })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_FIXED)
})

test('스킬 목록에서는 고친 번역과 기본 번역표의 번역문을 모두 영어 원문으로 되돌립니다', async ($, on) => {
  setupWorld(on, { store: FIXED })
  await describeCommand($, HELP_EN)
  expect((await sendListing($, `- help: ${HELP_FIXED}`)).text).toBe(`- help: ${HELP_EN}`)
  expect((await sendListing($, `- help: ${HELP_KO}`)).text).toBe(`- help: ${HELP_EN}`)
})

test('다른 세션이 고친 번역을 바꾼 뒤에도 이전 번역문을 영어 원문으로 되돌립니다', async ($, on) => {
  const world = setupWorld(on, { store: FIXED })
  await describeCommand($, HELP_EN)
  world.saved.set('overrides', { commands: { [HELP_EN]: '도움말' }, config: {} })
  await $.command.run({ command: 'korean-ui-translate', args: '' })
  expect((await describeCommand($, HELP_EN)).description).toBe('도움말')
  expect((await sendListing($, `- help: ${HELP_FIXED}`)).text).toBe(`- help: ${HELP_EN}`)
})

test('고친 번역만 있는 원문은 미번역으로 보지 않습니다', async ($, on) => {
  const world = setupWorld(on, { store: { overrides: { commands: { [CLEAR_EN]: CLEAR_KO }, config: {} } } })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  const result = await $.command.run({ command: 'korean-ui-translate', args: '' })
  expect(result.text).toBe(`${MESSAGES.nothing} ${MESSAGES.othersHint}`)
  expect(world.prompts).toEqual([])
})

test('내보내기는 기본 항목의 고친 번역을 넣습니다', async ($, on) => {
  const world = setupWorld(on, { store: FIXED })
  await describeCommand($, HELP_EN)
  await $.command.run({ command: 'korean-ui-translate', args: 'export' })
  expect(JSON.parse(world.written[0]?.text ?? '{}').commands[HELP_EN]).toBe(HELP_FIXED)
})

test('형식이 잘못된 고친 번역은 없는 것으로 봅니다', async ($, on) => {
  setupWorld(on, { store: { overrides: 'broken' } })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
})
