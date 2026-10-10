import { expect, test, type Engine } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import {
  BUILTIN,
  CLEAR_EN,
  CLEAR_KO,
  HELP_EN,
  HELP_KO,
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

// /korean-ui-reset 명령어를 실행합니다. args에 제공자 이름을 넣으면 그 제공자의 번역만 지웁니다.
function reset($: Engine, args = '') {
  return $.command.run({ command: 'korean-ui-reset', args })
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

test('실패 기록만 지우지 못하면 다시 시도한다고 하지 않고 기록이 남았다고 알려 줍니다', async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: TWO, failures: SKIPPED_ONE },
    askAnswer: remove,
    storeDeleteFailsFor: ['failures'],
  })
  const text = (await reset($)).text ?? ''
  expect(text.startsWith(`${MESSAGES.resetDone(2, 0)} 3번 실패한 문구의 기록은 지우지 못해서 다음에도 건너뜁니다. 원인:`)).toBe(true)
  expect(text.endsWith(MESSAGES.resetRetranslateHint)).toBe(true)
  expect(world.saved.has('dictionary')).toBe(false)
  expect(world.saved.get('failures')).toEqual(SKIPPED_ONE)
})

test('실패 기록만 있을 때 지우지 못하면 기록이 남았다고 알려 줍니다', async ($, on) => {
  const world = setupWorld(on, { store: { failures: SKIPPED_ONE }, askAnswer: remove, storeDeleteFailsFor: ['failures'] })
  const text = (await reset($)).text ?? ''
  expect(text.startsWith('3번 실패한 문구의 기록은 지우지 못해서 다음에도 건너뜁니다. 원인:')).toBe(true)
  expect(world.saved.get('failures')).toEqual(SKIPPED_ONE)
})

const HELP_FIXED = '도움말을 봅니다'
const MIXED = { commands: { [OTHER_EN]: OTHER_KO, [CLEAR_EN]: CLEAR_KO, Unseen: '확인하지 못한 문구' }, config: {} }
const OTHERS_ON = { options: { translate_others: true } }
const SECOND = { plugin: 'second@market', tier: 'user' } as const

test('전체 삭제는 고친 번역도 지웁니다', async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: TWO, overrides: { commands: { [HELP_EN]: HELP_FIXED }, config: {} } },
    askAnswer: remove,
  })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_FIXED)
  expect((await reset($)).text).toBe(`${MESSAGES.resetDone(3, 0)} ${MESSAGES.resetRetranslateHint}`)
  expect(world.questions).toEqual([MESSAGES.resetQuestion(3, 0)])
  expect(world.saved.has('overrides')).toBe(false)
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
  expect((await sendListing($, `- help: ${HELP_FIXED}`)).text).toBe(`- help: ${HELP_EN}`)
})

test('전체 삭제에서 고친 번역만 지우지 못하면 남았다고 알려 줍니다', async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: TWO, overrides: { commands: { [HELP_EN]: HELP_FIXED }, config: {} } },
    askAnswer: remove,
    storeDeleteFailsFor: ['overrides'],
  })
  const text = (await reset($)).text ?? ''
  expect(text.startsWith(`${MESSAGES.resetDone(2, 0)} 고친 번역은 지우지 못해서 그대로 남아 있습니다. 원인:`)).toBe(true)
  expect(world.saved.has('dictionary')).toBe(false)
  expect(world.saved.has('overrides')).toBe(true)
})

test('제공자를 지정하면 그 제공자의 번역과 실패 기록만 지웁니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, {
    store: {
      dictionary: MIXED,
      overrides: { commands: { [OTHER_EN]: '고친 배포 설명', [HELP_EN]: HELP_FIXED }, config: {} },
      failures: { version: VERSION, counts: { 'commands:Skipped command': 3, 'commands:Elsewhere': 3 } },
    },
    askAnswer: remove,
  })
  await describeCommand($, HELP_EN)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, 'Skipped command', OTHER, 'skipped')
  expect((await reset($, ' Other-Plugin@market ')).text).toBe(
    `${MESSAGES.resetDone(2, 1, 'other-plugin')} ${MESSAGES.resetRetranslateHint}`,
  )
  expect(world.questions).toEqual([MESSAGES.resetQuestion(2, 1, 'other-plugin')])
  expect(world.saved.get('dictionary')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO, Unseen: '확인하지 못한 문구' }, config: {} })
  expect(world.saved.get('overrides')).toEqual({ commands: { [HELP_EN]: HELP_FIXED }, config: {} })
  expect(world.saved.get('failures')).toEqual({ version: VERSION, counts: { 'commands:Elsewhere': 3 } })
  expect((await sendListing($, '- deploy: 고친 배포 설명')).text).toBe(`- deploy: ${OTHER_EN}`)
})

test('제공자를 지정했을 때의 질문과 결과에는 제공자 이름을 넣습니다', () => {
  expect(MESSAGES.resetQuestion(1, 0, 'other-plugin')).toBe(
    '기본 번역표의 번역은 그대로 남습니다. other-plugin의 Haiku로 번역한 문구 1개를 지울까요?',
  )
  expect(MESSAGES.resetQuestion(1, 1, 'other-plugin')).toBe(
    '기본 번역표의 번역은 그대로 남습니다. other-plugin의 Haiku로 번역한 문구 1개와 3번 실패한 문구의 기록 1개를 지울까요?',
  )
  expect(MESSAGES.resetQuestion(0, 1, 'other-plugin')).toBe(
    'other-plugin의 3번 실패한 문구의 기록 1개를 지워서 다음 번역 때 다시 시도하게 할까요?',
  )
  expect(MESSAGES.resetDone(1, 0, 'other-plugin')).toBe('other-plugin의 Haiku로 번역한 문구 1개를 지웠습니다.')
  expect(MESSAGES.resetDone(1, 1, 'other-plugin')).toBe(
    'other-plugin의 Haiku로 번역한 문구 1개와 3번 실패한 문구의 기록 1개를 지웠습니다. 건너뛰던 문구는 다음 번역 때 다시 시도합니다.',
  )
  expect(MESSAGES.resetDone(0, 1, 'other-plugin')).toBe(
    'other-plugin의 3번 실패한 문구의 기록 1개를 지웠습니다. 건너뛰던 문구는 다음 번역 때 다시 시도합니다.',
  )
})

test('claude-code를 지정하면 기본 항목의 자동 번역과 고친 번역만 지웁니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: MIXED, overrides: { commands: { [HELP_EN]: HELP_FIXED }, config: {} } },
    askAnswer: remove,
  })
  await describeCommand($, HELP_EN)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await reset($, 'claude-code')
  expect(world.saved.get('dictionary')).toEqual({ commands: { [OTHER_EN]: OTHER_KO, Unseen: '확인하지 못한 문구' }, config: {} })
  expect(world.saved.get('overrides')).toEqual({ commands: {}, config: {} })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
})

test('같은 원문을 두 제공자가 쓰면 한 제공자만 지워도 그 번역이 지워지고, 다른 원문의 번역은 남습니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: MIXED }, askAnswer: remove })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, OTHER_EN, SECOND, 'ship')
  await describeCommand($, CLEAR_EN, SECOND, 'wipe')
  await reset($, 'other-plugin')
  expect(world.saved.get('dictionary')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO, Unseen: '확인하지 못한 문구' }, config: {} })
  expect((await describeCommand($, OTHER_EN, SECOND, 'ship')).description).toBe(OTHER_EN)
})

test('일치하는 제공자가 없으면 묻지 않고 지정할 수 있는 이름을 보여 줍니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: MIXED }, askAnswer: remove })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await reset($, 'nope')).text).toBe(
    '일치하는 제공자가 없어서 아무것도 지우지 않았습니다(입력한 이름: nope). 지정할 수 있는 이름: claude-code, other-plugin',
  )
  expect(world.questions).toEqual([])
  expect(world.saved.get('dictionary')).toEqual(MIXED)
})

test('확인한 문구가 없을 때 제공자를 지정하면 확인한 문구가 없다고 알려 줍니다', async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: MIXED }, askAnswer: remove })
  expect((await reset($, 'nope')).text).toBe(
    '일치하는 제공자가 없어서 아무것도 지우지 않았습니다(입력한 이름: nope). 아직 확인한 문구가 없습니다.',
  )
  expect(world.saved.get('dictionary')).toEqual(MIXED)
})

test('그 제공자의 지울 번역이 없으면 묻지 않고 알려 줍니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: { commands: { [CLEAR_EN]: CLEAR_KO }, config: {} } }, askAnswer: remove })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  expect((await reset($, 'other-plugin')).text).toBe('other-plugin의 지울 번역이 없습니다.')
  expect(world.questions).toEqual([])
})

test('제공자를 지정하고 지우고 다시 번역을 고르면 그 제공자의 문구만 번역합니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: { commands: { [OTHER_EN]: '예전 번역' }, config: {} } },
    askAnswer: retranslate,
    replies: [answer({ '1': OTHER_KO })],
  })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await reset($, 'other-plugin')).text).toBe(
    `${MESSAGES.resetDone(1, 0, 'other-plugin')}\n명령어 설명 1개, 설정 항목 0개를 번역했습니다.`,
  )
  expect(world.prompts.length).toBe(1)
  expect(world.prompts[0]).not.toContain(CLEAR_EN)
  expect(world.saved.get('dictionary')).toEqual({ commands: { [OTHER_EN]: OTHER_KO }, config: {} })
})

test('제공자를 지정했을 때 취소를 고르면 아무것도 지우지 않습니다', OTHERS_ON, async ($, on) => {
  const world = setupWorld(on, { store: { dictionary: MIXED }, askAnswer: cancel })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  expect((await reset($, 'other-plugin')).text).toBe(MESSAGES.resetCanceled)
  expect(world.saved.get('dictionary')).toEqual(MIXED)
})

test('제공자를 지정했을 때 고친 번역만 저장하지 못하면 남았다고 알려 줍니다', OTHERS_ON, async ($, on) => {
  const overrides = { commands: { [OTHER_EN]: '고친 배포 설명' }, config: {} }
  const world = setupWorld(on, { store: { dictionary: MIXED, overrides }, askAnswer: remove, storeSetFailsFor: ['overrides'] })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  const text = (await reset($, 'other-plugin')).text ?? ''
  expect(text.startsWith(`${MESSAGES.resetDone(1, 0, 'other-plugin')} 고친 번역은 지우지 못해서 그대로 남아 있습니다. 원인:`)).toBe(true)
  expect(world.saved.get('overrides')).toEqual(overrides)
  expect((await describeCommand($, OTHER_EN, OTHER, 'deploy')).description).toBe('고친 배포 설명')
})
