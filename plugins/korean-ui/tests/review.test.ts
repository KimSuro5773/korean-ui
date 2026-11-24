// 0.2.2 전체 코드 검토에서 확인한 문제를 재현하고, 고친 뒤 다시 생기지 않는지 확인하는 테스트입니다.
import { expect, test } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation'
import {
  BUILTIN,
  CLEAR_EN,
  CLEAR_KO,
  HELP_EN,
  HELP_KO,
  GUIDE,
  OTHER,
  OTHER_EN,
  OTHER_KO,
  PLUGIN_JSON,
  answer,
  describeCommand,
  runCommand,
  sendListing,
  setupWorld,
  type World,
} from './helpers'

const OTHERS_ON = { options: { translate_others: true } }

test('한글이 없는 번역문 때문에 다른 명령어의 영어 설명 줄을 바꾸지 않습니다', OTHERS_ON, async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { 'Mal helper for reviews': 'Review a pull request' }, config: {} } } })
  const text = '- review: Review a pull request\n- review2: Review a pull request - Use when asked'
  expect((await sendListing($, text)).text).toBe(text)
})

test('이름 뒤에 표시 이름이 괄호로 붙은 스킬 목록 줄도 표시 이름으로 원문을 찾아 되돌립니다', async ($, on) => {
  setupWorld(on)
  await describeCommand($, HELP_EN, BUILTIN, 'ship')
  expect((await sendListing($, `- ship-local (ship): ${HELP_KO} - Never call it yourself`)).text).toBe(
    `- ship-local (ship): ${HELP_EN} - Never call it yourself`,
  )
})

test('관리 명령어의 결과는 화면에만 표시하고 Claude에게 보내는 요청에는 넣지 않습니다', async ($, on) => {
  setupWorld(on)
  expect((await runCommand($, 'korean-ui-status')).isTextDisplayOnly).toBe(true)
  expect((await runCommand($, 'korean-ui-translate')).isTextDisplayOnly).toBe(true)
  expect((await runCommand($, 'korean-ui-reset')).isTextDisplayOnly).toBe(true)
})

test('(currently …) 부분에만 한글이 있는 설명도 스킬 목록에서 영어 원문으로 되돌립니다', OTHERS_ON, async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { 'Switch persona': '페르소나를 전환합니다' }, config: {} } } })
  const shown = (await describeCommand($, 'Switch persona (currently 기본)', OTHER, 'persona')).description
  expect(shown).toBe('페르소나를 전환합니다(현재 기본)')
  expect((await sendListing($, `- persona: ${shown}`)).text).toBe('- persona: Switch persona (currently 기본)')
  expect((await sendListing($, '- persona: 이전 번역(현재 기본)')).text).toBe('- persona: Switch persona (currently 기본)')
})

test('번역을 꺼 둔 제공자는 지우고 다시 번역을 골라도 Haiku를 부르지 않고 설정을 켜라고 안내합니다', async ($, on) => {
  const world = setupWorld(on, {
    store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } },
    askAnswer: MESSAGES.resetChoices.retranslate,
  })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  const text = (await runCommand($, 'korean-ui-reset', 'other-plugin')).text
  expect(text).toBe(`${MESSAGES.resetDone(1, 0, 'other-plugin')}\n${MESSAGES.retranslateOff(MESSAGES.categoryNames.others)}`)
  expect(world.prompts).toEqual([])
})

test('번역을 꺼 둔 제공자를 지우기만 하면 설정을 켠 뒤 번역하라고 안내합니다', async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } }, askAnswer: MESSAGES.resetChoices.remove })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  expect((await runCommand($, 'korean-ui-reset', 'other-plugin')).text).toBe(
    `${MESSAGES.resetDone(1, 0, 'other-plugin')} ${MESSAGES.resetOffHint(MESSAGES.categoryNames.others)}`,
  )
})

test('번역하는 도중에는 미번역 알림을 띄우지도 기록하지도 않습니다', async ($, on) => {
  const world: World = setupWorld(on, {
    store: { dictionary: { commands: { [CLEAR_EN]: '예전 번역' }, config: {} } },
    files: {
      'locales/ko.json': JSON.stringify({ commands: {}, config: {} }),
      'locales/ko-guide.md': GUIDE,
      '.claude-plugin/plugin.json': PLUGIN_JSON,
    },
    askAnswer: MESSAGES.resetChoices.retranslate,
    replies: [
      // 번역하는 동안 Claude Code가 메뉴를 다시 그려 아직 번역되지 않은 설명이 다시 들어오는 상황입니다.
      async () => {
        await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
        await world.clock.advance(1500)
        return answer({ '1': CLEAR_KO })
      },
    ],
  })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await world.clock.advance(1500)
  expect(world.toasts).toEqual([])
  await runCommand($, 'korean-ui-reset')
  expect(world.toasts).toEqual([])
  expect(world.saved.get('notified')).toBeUndefined()
})

test('지운 번역문 뒤에 한국어 when_to_use가 붙은 줄은 when_to_use를 남기고 되돌립니다', OTHERS_ON, async ($, on) => {
  setupWorld(on, { store: { dictionary: { commands: { [OTHER_EN]: OTHER_KO }, config: {} } }, askAnswer: MESSAGES.resetChoices.remove })
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await runCommand($, 'korean-ui-reset')
  expect((await sendListing($, `- deploy: ${OTHER_KO} - 배포를 요청할 때 사용`)).text).toBe(`- deploy: ${OTHER_EN} - 배포를 요청할 때 사용`)
})
