import { expect, test, type Engine } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import {
  BUILTIN,
  CLEAR_EN,
  CLEAR_KO,
  OTHER,
  OTHER_EN,
  USAGE,
  answer,
  apiError,
  describeCommand,
  describeConfig,
  rawAnswer,
  setupWorld,
  startSession,
} from './helpers.ts'

// /korean-ui-translate 명령어를 실행합니다.
function run($: Engine, args = '') {
  return $.command.run({ command: 'korean-ui-translate', args })
}

test('세션이 시작되면 번역 명령어를 등록합니다', async ($, on) => {
  const world = setupWorld(on)
  await startSession($)
  expect(world.registered).toEqual([
    { name: 'korean-ui-translate', description: MESSAGES.commandDescription, argumentHint: '[export]' },
  ])
})

test('미번역 기본 항목을 번역해서 저장하고 요약을 표시합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer({ '1': CLEAR_KO })] })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  const result = await run($)
  expect(result.text).toBe(`명령어 설명 1개, 설정 항목 0개를 번역했습니다. ${MESSAGES.othersHint}`)
  expect(world.saved.get('dictionary')).toEqual({ commands: { [CLEAR_EN]: CLEAR_KO }, config: {} })
  expect(world.prompts[0]).toContain(CLEAR_EN)
  expect((await describeCommand($, CLEAR_EN, BUILTIN, 'clear')).description).toBe(CLEAR_KO)
})

test('/config 기본 항목도 번역합니다', async ($, on) => {
  setupWorld(on, { replies: [answer({ '1': '시험용 설정' })] })
  await describeConfig($, 'Sample setting', BUILTIN, 'sample')
  expect((await run($)).text).toBe(`명령어 설명 0개, 설정 항목 1개를 번역했습니다. ${MESSAGES.othersHint}`)
  expect((await describeConfig($, 'Sample setting', BUILTIN, 'sample')).label).toBe('시험용 설정')
})

test('번역할 문구가 없으면 모델을 호출하지 않습니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, '이미 한국어로 작성한 설명입니다', OTHER, 'mine')
  await describeCommand($, '', BUILTIN, 'empty')
  expect((await run($)).text).toBe(`${MESSAGES.nothing} ${MESSAGES.othersHint}`)
  expect(world.prompts).toEqual([])
})

test('번역 항목이 모두 꺼져 있으면 안내만 표시합니다', { options: { translate_builtin: false, translate_others: false } }, async ($, on) => {
  const world = setupWorld(on)
  expect((await run($)).text).toBe(MESSAGES.noCategory)
  expect(world.prompts).toEqual([])
})

test('(currently …)가 붙은 설명은 앞부분만 Haiku에게 보내고 저장합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer({ '1': '시험용 선택지를 고릅니다' })] })
  await describeCommand($, 'Pick a sample option (currently A)', BUILTIN, 'pick')
  await run($)
  expect(world.prompts[0]).toContain('"text": "Pick a sample option"')
  expect(world.prompts[0]).not.toContain('(currently')
  expect(world.saved.get('dictionary')).toEqual({ commands: { 'Pick a sample option': '시험용 선택지를 고릅니다' }, config: {} })
  expect((await describeCommand($, 'Pick a sample option (currently B)', BUILTIN, 'pick')).description).toBe(
    '시험용 선택지를 고릅니다(현재 B)',
  )
})

test('번역을 꺼 둔 다른 플러그인의 문구는 Haiku에게 보내지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer({ '1': CLEAR_KO })] })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await run($)
  expect(world.prompts.length).toBe(1)
  expect(world.prompts[0]).not.toContain(OTHER_EN)
})

test('Haiku 호출이 실패하면 중단하고, 앞에서 저장한 번역은 유지합니다', async ($, on) => {
  const sources = Array.from({ length: 51 }, (_, i) => `Command ${String(i + 1).padStart(2, '0')}`)
  const first = Object.fromEntries(sources.slice(0, 50).map((_, i) => [String(i + 1), `명령어 ${String(i + 1).padStart(2, '0')}`]))
  const world = setupWorld(on, { replies: [answer(first), apiError(529)] })
  for (const [index, source] of sources.entries()) await describeCommand($, source, BUILTIN, `cmd${index}`)
  const result = await run($)
  expect(result.text).toBe(`명령어 설명 50개, 설정 항목 0개를 번역했습니다. ${MESSAGES.modelFailed('API 오류(상태 코드 529)')}`)
  const saved = world.saved.get('dictionary') as { commands: Record<string, string> }
  expect(Object.keys(saved.commands).length).toBe(50)
})

test('형식에 맞지 않는 응답은 실패로 세고 저장하지 않습니다', async ($, on) => {
  const world = setupWorld(on, { replies: [rawAnswer('죄송합니다. 번역할 수 없습니다.')] })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await run($)).text).toBe(
    `명령어 설명 0개, 설정 항목 0개를 번역했습니다. 실패한 1개는 다음에 실행할 때 다시 번역합니다. ${MESSAGES.othersHint}`,
  )
  expect(world.saved.get('dictionary')).toBeUndefined()
})

test('Haiku가 빈 응답을 보내면 그 요청에 담은 문구만 실패로 셉니다', async ($, on) => {
  setupWorld(on, { replies: [{ value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }] })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await run($)).text).toBe(
    `명령어 설명 0개, 설정 항목 0개를 번역했습니다. 실패한 1개는 다음에 실행할 때 다시 번역합니다. ${MESSAGES.othersHint}`,
  )
})

test('번역 지침을 읽지 못하면 번역을 시작하지 않습니다', async ($, on) => {
  const world = setupWorld(on, { files: { 'locales/ko.json': '{"commands":{},"config":{}}', 'locales/ko-guide.md': null } })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await run($)).text).toContain('번역 지침 파일(locales/ko-guide.md)을 읽지 못해서 번역을 시작하지 않았습니다.')
  expect(world.prompts).toEqual([])
})

test('저장하기 직전에 다른 세션이 저장한 번역과 합칩니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer({ '1': CLEAR_KO })] })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  world.saved.set('dictionary', { commands: { 'Saved by another session': '다른 세션이 저장한 번역' }, config: {} })
  await run($)
  expect(world.saved.get('dictionary')).toEqual({
    commands: { 'Saved by another session': '다른 세션이 저장한 번역', [CLEAR_EN]: CLEAR_KO },
    config: {},
  })
})

test('번역 결과를 저장하지 못하면 중단하고 원인을 표시합니다', async ($, on) => {
  setupWorld(on, { replies: [answer({ '1': CLEAR_KO })], storeSetFails: true })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  expect((await run($)).text).toContain('번역 결과를 저장하지 못해서 번역을 중단했습니다.')
})

test('알 수 없는 인자를 받으면 사용법을 표시합니다', async ($, on) => {
  setupWorld(on)
  expect((await run($, 'help')).text).toBe(MESSAGES.usage)
})
