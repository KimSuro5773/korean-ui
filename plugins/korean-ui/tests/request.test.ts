import { expect, test, type Engine } from 'claude-code/testing'
import { SELECTION_GUIDE, confirmQuestion, requestResultText } from '../hooks/lib/request.ts'
import { MESSAGES, failedListText } from '../hooks/lib/translation.ts'
import {
  BUILTIN,
  CLEAR_EN,
  CLEAR_KO,
  GUIDE,
  HELP_EN,
  HELP_KO,
  MODEL_EN,
  OTHER,
  OTHER_EN,
  VERSION,
  answer,
  apiError,
  describeCommand,
  rawAnswer,
  sendListing,
  setupWorld,
  type World,
} from './helpers.ts'

// /korean-ui-translate를 요청 문장과 함께 실행합니다.
function request($: Engine, args: string) {
  return $.command.run({ command: 'korean-ui-translate', args })
}

// 기본 번역표에 있는 /help와 번역문이 없는 /clear를 화면에서 확인한 상태로 만듭니다.
// 원문순으로 /help("Show…")가 1번, /clear("Start…")가 2번 후보입니다.
async function seeTwo($: Engine) {
  await describeCommand($, HELP_EN)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
}

// Haiku가 선택 호출에서 그 id들을 고른 것처럼 만드는 가짜 응답입니다.
const pick = (...ids: string[]) => rawAnswer(JSON.stringify({ targets: ids }))
const { proceed, cancel } = MESSAGES.requestChoices
const HELP_SHORT = '도움말 표시'
const HELP_TARGET = { kind: 'commands' as const, source: HELP_EN, names: ['/help'], providers: ['claude-code'], current: HELP_KO }

test('대상이 모두 미번역이면 확인 없이 번역해서 고친 번역에 저장합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('2'), answer({ '1': CLEAR_KO })] })
  await seeTwo($)
  expect((await request($, 'clear 명령어를 번역해 줘')).text).toBe(
    requestResultText({ commands: 1, config: 0 }, [{ name: '/clear', after: CLEAR_KO }], 0, 0),
  )
  expect(world.questions).toEqual([])
  expect(world.saved.get('overrides')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO }, config: {} })
  expect(world.saved.has('dictionary')).toBe(false)
  expect(world.systems).toEqual([SELECTION_GUIDE, GUIDE])
  expect(world.prompts[0]).toContain('사용자 요청: clear 명령어를 번역해 줘')
  expect(world.statuses).toEqual(['대상 선택 중', '번역 중 0/1', '번역 중 1/1', undefined])
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe(CLEAR_KO)
})

test('기존 번역을 바꾸는 요청은 확인을 받고, 지금 번역문과 요청을 함께 보냅니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('1'), answer({ '1': HELP_SHORT })], askAnswer: proceed })
  await seeTwo($)
  expect((await request($, '/help 설명을 더 짧게 고쳐 줘')).text).toBe(
    requestResultText({ commands: 1, config: 0 }, [{ name: '/help', before: HELP_KO, after: HELP_SHORT }], 0, 0),
  )
  expect(world.questions).toEqual([confirmQuestion([HELP_TARGET])])
  expect(world.prompts[1]).toContain('사용자 요청: /help 설명을 더 짧게 고쳐 줘')
  expect(world.prompts[1]).toContain(`"current": "${HELP_KO}"`)
  expect(world.saved.get('overrides')).toEqual({ commands: { [HELP_EN]: HELP_SHORT }, config: {} })
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_SHORT)
})

test('미번역 문구와 기존 번역이 함께 대상이면 확인을 받고 모두 번역합니다', async ($, on) => {
  const world = setupWorld(on, {
    replies: [pick('1', '2'), answer({ '1': HELP_SHORT, '2': CLEAR_KO })],
    askAnswer: proceed,
  })
  await seeTwo($)
  await request($, '모든 설명을 다시 번역해 줘')
  expect(world.questions).toEqual(['기존 번역 1개를 다시 번역하고, 미번역 문구 1개를 번역합니다: /help, /clear. 진행할까요?'])
  expect(world.saved.get('overrides')).toEqual({ commands: { [HELP_EN]: HELP_SHORT, [CLEAR_EN]: CLEAR_KO }, config: {} })
})

for (const [label, askAnswer] of [
  ['취소를 고르면', cancel],
  ['대화상자를 닫거나 띄울 수 없으면', null],
  ['선택지와 다른 답을 입력하면', '네'],
] as const) {
  test(`기존 번역을 바꾸는 요청에서 ${label} 번역하지 않습니다`, async ($, on) => {
    const world = setupWorld(on, { replies: [pick('1')], askAnswer })
    await seeTwo($)
    expect((await request($, '/help 설명을 고쳐 줘')).text).toBe(MESSAGES.requestCanceled)
    expect(world.prompts.length).toBe(1)
    expect(world.saved.has('overrides')).toBe(false)
    expect(world.statuses.at(-1)).toBeUndefined()
  })
}

test('선택 응답을 읽을 수 없으면 아무것도 바꾸지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [rawAnswer('잘 모르겠습니다')] })
  await seeTwo($)
  expect((await request($, '고쳐 줘')).text).toBe(MESSAGES.requestUnreadable)
  expect(world.prompts.length).toBe(1)
  expect(world.statuses.at(-1)).toBeUndefined()
})

test('선택 응답이 비어 있으면 읽을 수 없는 응답으로 처리합니다', async ($, on) => {
  const usage = { input_tokens: 1, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const world = setupWorld(on, { replies: [{ value: { isAnswered: false, reason: 'empty-reply', usage } }] })
  await seeTwo($)
  expect((await request($, '고쳐 줘')).text).toBe(MESSAGES.requestUnreadable)
  expect(world.prompts.length).toBe(1)
})

test('해당하는 문구가 없거나 목록에 없는 id만 오면 아무것도 바꾸지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('99')] })
  await seeTwo($)
  expect((await request($, '없는 명령어를 고쳐 줘')).text).toBe(`${MESSAGES.requestNoTargets} ${MESSAGES.othersHint}`)
  expect(world.prompts.length).toBe(1)
})

test('선택 호출이 API 오류로 실패하면 원인을 표시하고 바꾸지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [apiError(529)] })
  await seeTwo($)
  expect((await request($, '고쳐 줘')).text).toBe(MESSAGES.modelFailed('API 오류(상태 코드 529)'))
  expect(world.saved.has('overrides')).toBe(false)
})

test('번역문이 지금과 같으면 저장하지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('1'), answer({ '1': HELP_KO })], askAnswer: proceed })
  await seeTwo($)
  expect((await request($, '/help 설명을 고쳐 줘')).text).toBe(requestResultText({ commands: 0, config: 0 }, [], 1, 0))
  expect(world.saved.has('overrides')).toBe(false)
})

test('자유 요청은 3번 실패 기록을 읽지도 쓰지도 않습니다', async ($, on) => {
  const failures = { version: VERSION, counts: { [`commands:${CLEAR_EN}`]: 3 } }
  const world = setupWorld(on, { store: { failures }, replies: [pick('2'), rawAnswer('번역할 수 없습니다')] })
  await seeTwo($)
  expect((await request($, 'clear 명령어를 번역해 줘')).text).toBe(
    `${requestResultText({ commands: 0, config: 0 }, [], 0, 1)}${failedListText([{ source: CLEAR_EN, reason: { code: 'unparsable' } }])}`,
  )
  expect(world.prompts.length).toBe(2)
  expect(world.saved.get('failures')).toEqual(failures)
})

test('번역을 꺼 둔 범주의 문구는 후보에 넣지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick()] })
  await seeTwo($)
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await request($, '배포 명령어를 번역해 줘')
  expect(world.prompts[0]).toContain(HELP_EN)
  expect(world.prompts[0]).not.toContain(OTHER_EN)
})

test('번역 항목이 모두 꺼져 있으면 요청해도 안내만 표시합니다', { options: { translate_builtin: false, translate_others: false } }, async ($, on) => {
  const world = setupWorld(on)
  expect((await request($, '고쳐 줘')).text).toBe(MESSAGES.noCategory)
  expect(world.prompts).toEqual([])
})

test('확인한 문구가 없으면 모델을 호출하지 않습니다', async ($, on) => {
  const world = setupWorld(on)
  expect((await request($, '고쳐 줘')).text).toBe(`${MESSAGES.requestNoCandidates} ${MESSAGES.othersHint}`)
  expect(world.prompts).toEqual([])
})

test('번역 지침을 읽지 못하면 요청을 시작하지 않습니다', async ($, on) => {
  const world = setupWorld(on, { files: { 'locales/ko.json': '{"commands":{},"config":{}}', 'locales/ko-guide.md': null } })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await request($, '번역해 줘')).text).toContain('번역 지침 파일(locales/ko-guide.md)을 읽지 못해서 번역을 시작하지 않았습니다.')
  expect(world.prompts).toEqual([])
})

test('고친 번역을 다시 고쳐도 이전 번역문을 스킬 목록에서 영어 원문으로 되돌립니다', async ($, on) => {
  setupWorld(on, {
    store: { overrides: { commands: { [HELP_EN]: '도움말을 봅니다' }, config: {} } },
    replies: [pick('1'), answer({ '1': HELP_SHORT })],
    askAnswer: proceed,
  })
  await seeTwo($)
  await request($, '/help 설명을 더 짧게 고쳐 줘')
  expect((await sendListing($, '- help: 도움말을 봅니다')).text).toBe(`- help: ${HELP_EN}`)
  expect((await sendListing($, `- help: ${HELP_SHORT}`)).text).toBe(`- help: ${HELP_EN}`)
})

test('(currently …)가 붙은 명령어는 상태 표시를 뗀 원문으로 저장하고 (현재 …)를 붙여 표시합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('1'), answer({ '1': '모델 설정' })], askAnswer: proceed })
  await describeCommand($, `${MODEL_EN} (currently Opus 5.5)`, BUILTIN, 'model')
  await request($, '/model 설명을 더 짧게 고쳐 줘')
  expect(world.prompts[0]).not.toContain('(currently')
  expect(world.saved.get('overrides')).toEqual({ commands: { [MODEL_EN]: '모델 설정' }, config: {} })
  expect((await describeCommand($, `${MODEL_EN} (currently Fable 5.1)`, BUILTIN, 'model')).description).toBe('모델 설정(현재 Fable 5.1)')
})

test('대상이 50개를 넘어 묶음이 나뉘어도 번역문을 제 원문에 저장합니다', async ($, on) => {
  const sources = Array.from({ length: 51 }, (_, i) => `Command ${String(i + 1).padStart(2, '0')}`)
  const first = Object.fromEntries(sources.slice(0, 50).map((_, i) => [String(i + 1), `명령어 ${i + 1}`]))
  const world = setupWorld(on, {
    files: { 'locales/ko.json': '{"commands":{},"config":{}}', 'locales/ko-guide.md': GUIDE },
    replies: [pick(...sources.map((_, i) => String(i + 1))), answer(first), answer({ '1': '명령어 51' })],
  })
  for (const [index, source] of sources.entries()) await describeCommand($, source, BUILTIN, `cmd${index}`)
  await request($, '모두 번역해 줘')
  const saved = world.saved.get('overrides') as { commands: Record<string, string> }
  expect(Object.keys(saved.commands).length).toBe(51)
  expect(saved.commands['Command 01']).toBe('명령어 1')
  expect(saved.commands['Command 50']).toBe('명령어 50')
  expect(saved.commands['Command 51']).toBe('명령어 51')
  expect(world.statuses).toEqual(['대상 선택 중', '번역 중 0/51', '번역 중 50/51', '번역 중 51/51', undefined])
})

test('후보가 200개를 넘으면 선택 호출을 나누고 고른 대상을 합칩니다', async ($, on) => {
  const sources = Array.from({ length: 201 }, (_, i) => `Command ${String(i + 1).padStart(3, '0')}`)
  const world = setupWorld(on, {
    files: { 'locales/ko.json': '{"commands":{},"config":{}}', 'locales/ko-guide.md': GUIDE },
    replies: [pick('200'), pick('1'), answer({ '1': '명령어 200', '2': '명령어 201' })],
  })
  for (const [index, source] of sources.entries()) await describeCommand($, source, BUILTIN, `cmd${index}`)
  await request($, '마지막 두 개를 번역해 줘')
  expect(world.systems).toEqual([SELECTION_GUIDE, SELECTION_GUIDE, GUIDE])
  expect(world.saved.get('overrides')).toEqual({ commands: { 'Command 200': '명령어 200', 'Command 201': '명령어 201' }, config: {} })
})

test('선택한 뒤 다른 세션이 저장한 고친 번역과 합쳐서 저장합니다', async ($, on) => {
  const world: World = setupWorld(on, {
    replies: [
      pick('2'),
      () => {
        world.saved.set('overrides', { commands: { 'Saved by another session': '다른 세션의 번역' }, config: {} })
        return answer({ '1': CLEAR_KO })
      },
    ],
  })
  await seeTwo($)
  await request($, 'clear 명령어를 번역해 줘')
  expect(world.saved.get('overrides')).toEqual({
    commands: { 'Saved by another session': '다른 세션의 번역', [CLEAR_EN]: CLEAR_KO },
    config: {},
  })
})

test('번역 호출이 중간에 실패하면 원인을 표시하고 진행 표시를 지웁니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('2'), apiError(529)] })
  await seeTwo($)
  expect((await request($, 'clear 명령어를 번역해 줘')).text).toBe(
    `${requestResultText({ commands: 0, config: 0 }, [], 0, 0)} ${MESSAGES.modelFailed('API 오류(상태 코드 529)')}`,
  )
  expect(world.statuses.at(-1)).toBeUndefined()
})

test('고친 번역을 저장하지 못하면 중단하고 원인을 표시합니다', async ($, on) => {
  setupWorld(on, { replies: [pick('2'), answer({ '1': CLEAR_KO })], storeSetFailsFor: ['overrides'] })
  await seeTwo($)
  expect((await request($, 'clear 명령어를 번역해 줘')).text).toContain('번역 결과를 저장하지 못해서 번역을 중단했습니다.')
})

test('/config 항목도 요청으로 번역해서 고친 번역에 저장합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [pick('1'), answer({ '1': '시험용 설정' })] })
  await $.config.describe({ key: 'sample', label: 'Sample setting', isHidden: false, provider: BUILTIN })
  expect((await request($, '설정 항목을 번역해 줘')).text).toBe(
    requestResultText({ commands: 0, config: 1 }, [{ name: 'sample', after: '시험용 설정' }], 0, 0),
  )
  expect(world.saved.get('overrides')).toEqual({ commands: {}, config: { 'Sample setting': '시험용 설정' } })
})
