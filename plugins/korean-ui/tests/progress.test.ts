import { expect, test, type Engine } from 'claude-code/testing'
import { BUILTIN, answer, apiError, describeCommand, setupWorld } from './helpers.ts'

// /korean-ui-translate 명령어를 실행합니다.
function run($: Engine) {
  return $.command.run({ command: 'korean-ui-translate', args: '' })
}

const SOURCES = Array.from({ length: 51 }, (_, i) => `Command ${String(i + 1).padStart(2, '0')}`)
const FIRST = Object.fromEntries(SOURCES.slice(0, 50).map((_, i) => [String(i + 1), `명령어 ${i + 1}`]))

test('묶음 하나를 처리할 때마다 진행 상황을 갱신하고, 끝나면 지웁니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer(FIRST), answer({ '1': '명령어 51' })] })
  for (const [index, source] of SOURCES.entries()) await describeCommand($, source, BUILTIN, `cmd${index}`)
  await run($)
  expect(world.statuses).toEqual(['번역 중 0/51', '번역 중 50/51', '번역 중 51/51', undefined])
})

test('Haiku 호출이 실패해서 중단해도 진행 표시를 지웁니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer(FIRST), apiError(529)] })
  for (const [index, source] of SOURCES.entries()) await describeCommand($, source, BUILTIN, `cmd${index}`)
  await run($)
  expect(world.statuses).toEqual(['번역 중 0/51', '번역 중 50/51', undefined])
})

test('실패한 문구도 처리한 수에 포함합니다', async ($, on) => {
  const world = setupWorld(on, { replies: [answer({})] })
  await describeCommand($, 'Exit the CLI', BUILTIN, 'exit')
  await run($)
  expect(world.statuses).toEqual(['번역 중 0/1', '번역 중 1/1', undefined])
})

test('번역할 문구가 없으면 진행 문구를 표시하지 않습니다', async ($, on) => {
  const world = setupWorld(on)
  await run($)
  expect(world.statuses.filter((text) => text !== undefined)).toEqual([])
})
