import { expect, test, type Engine } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import {
  BUILTIN,
  CLEAR_EN,
  CLEAR_KO,
  OTHER,
  OTHER_EN,
  OTHER_KO,
  VERSION,
  answer,
  describeCommand,
  sendListing,
  setupWorld,
  type World,
} from './helpers.ts'

// /korean-ui-reset 명령어를 실행합니다.
function reset($: Engine) {
  return $.command.run({ command: 'korean-ui-reset', args: '' })
}

const TWO = { commands: { [CLEAR_EN]: CLEAR_KO }, config: { 'Sample setting': '시험용 설정' } }
const SKIPPED_ONE = { version: VERSION, counts: { 'commands:Skipped command': 3 } }
const { remove, retranslate, cancel } = MESSAGES.resetChoices

test('지울 번역이 없으면 묻지 않고 알려 줍니다', async ($, on) => {
  const world = setupWorld(on, { askAnswer: remove })
  expect((await reset($)).text).toBe(MESSAGES.resetNothing)
  expect(world.questions).toEqual([])
})

test('지우기를 고르면 Haiku 번역과 실패 횟수를 지우고 메뉴에 영어 원문을 표시합니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: TWO, failures: SKIPPED_ONE }, askAnswer: remove })
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe(CLEAR_KO)
  expect((await reset($)).text).toBe(`${MESSAGES.resetDone(2, 1)} ${MESSAGES.resetRetranslateHint}`)
  expect(world.questions).toEqual([MESSAGES.resetQuestion(2, 1)])
  expect(world.saved.has('dictionary')).toBe(false)
  expect(world.saved.has('failures')).toBe(false)
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe(CLEAR_EN)
})

test('지우고 다시 번역을 고르면 지운 뒤 바로 번역합니다', async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: { commands: { [CLEAR_EN]: '예전 번역' }, config: {} } },
    askAnswer: retranslate,
    replies: [answer({ '1': CLEAR_KO })],
  })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await reset($)).text).toBe(
    `${MESSAGES.resetDone(1, 0)}\n명령어 설명 1개, 설정 항목 0개를 번역했습니다. ${MESSAGES.othersHint}`,
  )
  expect(world.saved.get('dictionary')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO }, config: {} })
})

test('취소를 고르면 아무것도 지우지 않습니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: TWO }, askAnswer: cancel })
  expect((await reset($)).text).toBe(MESSAGES.resetCanceled)
  expect(world.saved.get('dictionary')).toEqual(TWO)
})

test('선택지와 다른 답을 직접 입력하면 취소로 처리합니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: TWO }, askAnswer: '지우기 해 줘' })
  expect((await reset($)).text).toBe(MESSAGES.resetCanceled)
  expect(world.saved.get('dictionary')).toEqual(TWO)
})

test('대화상자를 닫거나 띄울 수 없으면 취소로 처리합니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: TWO } })
  expect((await reset($)).text).toBe(MESSAGES.resetCanceled)
  expect(world.saved.get('dictionary')).toEqual(TWO)
})

test('번역 사전을 지우지 못하면 원인을 표시하고 실패 횟수도 지우지 않습니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: TWO, failures: SKIPPED_ONE }, askAnswer: remove, storeDeleteFails: true })
  expect((await reset($)).text).toContain('번역을 지우지 못했습니다. 원인:')
  expect(world.saved.get('dictionary')).toEqual(TWO)
  expect(world.saved.get('failures')).toEqual(SKIPPED_ONE)
})

test('건너뛴 문구만 있으면 다시 번역할 수 있게 할지 묻고 실패 횟수를 지웁니다', async ($, on) => {
  const world = setupWorld(on, { store: { failures: SKIPPED_ONE }, askAnswer: remove })
  expect((await reset($)).text).toBe(`${MESSAGES.resetDone(0, 1)} ${MESSAGES.resetRetranslateHint}`)
  expect(world.questions).toEqual([MESSAGES.resetQuestion(0, 1)])
  expect(world.saved.has('failures')).toBe(false)
})

test('reset으로 지운 번역문이 이전 스킬 목록에 남아 있어도 영어 원문으로 되돌립니다', { options: { translate_others: true } }, async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } }, askAnswer: remove })
  expect((await describeCommand($, OTHER_EN, OTHER, 'deploy')).description).toBe(OTHER_KO)
  await reset($)
  expect((await sendListing($, `- deploy: ${OTHER_KO}`)).text).toBe(`- deploy: ${OTHER_EN}`)
})

test('다른 세션이 번역을 지운 뒤 다시 읽어도 이전 스킬 목록의 번역문을 영어 원문으로 되돌립니다', { options: { translate_others: true } }, async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } } })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  world.saved.delete('dictionary')
  await $.command.run({ command: 'korean-ui-translate', args: '' })
  expect((await sendListing($, `- deploy: ${OTHER_KO}`)).text).toBe(`- deploy: ${OTHER_EN}`)
})

test('번역을 저장하며 합칠 때 다른 세션이 지운 번역문도 영어 원문으로 되돌립니다', { options: { translate_others: true } }, async ($, on) => {
  const world: World = setupWorld(on, {
    store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } },
    replies: [
      () => {
        world.saved.delete('dictionary')
        return answer({ '1': CLEAR_KO })
      },
    ],
  })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await $.command.run({ command: 'korean-ui-translate', args: '' })
  expect(world.saved.get('dictionary')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO }, config: {} })
  expect((await sendListing($, `- deploy: ${OTHER_KO}`)).text).toBe(`- deploy: ${OTHER_EN}`)
})
