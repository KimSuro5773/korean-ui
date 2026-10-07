import { expect, test, type Engine } from 'claude-code/testing'
import { MESSAGES } from '../hooks/lib/translation.ts'
import { BUILTIN, CLEAR_EN, HELP_EN, HELP_KO, OTHER, OTHER_EN, describeCommand, describeConfig, setupWorld } from './helpers.ts'

// /korean-ui-translate export를 실행합니다.
function runExport($: Engine) {
  return $.command.run({ command: 'korean-ui-translate', args: 'export' })
}

test('내보내기는 확인한 기본 항목의 번역만 정렬해서 저장합니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, HELP_EN)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await describeConfig($, 'Theme')
  const result = await runExport($)
  expect(result.text).toBe(MESSAGES.exported('/work/korean-ui-ko.json', 1))
  expect(world.written.length).toBe(1)
  // 공식 테스트 도구는 경로를 운영체제에 맞는 절대 경로로 바꾸어 전달하므로, 구분 기호를 맞춘 뒤 끝부분을 확인합니다.
  expect((world.written[0]?.path ?? '').replaceAll('\\', '/')).toMatch(/\/work\/korean-ui-ko\.json$/)
  expect(JSON.parse(world.written[0]?.text ?? '')).toEqual({ commands: { [HELP_EN]: HELP_KO }, config: { Theme: '테마' } })
})

test('Windows 작업 폴더에서는 안내 문구의 경로를 역슬래시로 이어 붙입니다', async ($, on) => {
  setupWorld(on, { cwd: 'C:\\work' })
  await describeCommand($, HELP_EN)
  expect((await runExport($)).text).toBe(MESSAGES.exported('C:\\work\\korean-ui-ko.json', 0))
})

test('확인한 기본 항목이 없으면 파일을 쓰지 않습니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  expect((await runExport($)).text).toBe(MESSAGES.exportNothingSeen)
  expect(world.written).toEqual([])
})

test('내보내기 파일을 쓰지 못하면 원인과 경로를 표시합니다', async ($, on) => {
  setupWorld(on, { writeFails: true })
  await describeCommand($, HELP_EN)
  const text = (await runExport($)).text ?? ''
  expect(text).toContain('내보내기 파일을 저장하지 못했습니다.')
  expect(text).toContain('/work/korean-ui-ko.json')
})

test('미번역 문구를 발견하면 1.5초 뒤에 알림을 한 번 표시합니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await describeConfig($, 'Sample setting', BUILTIN, 'sample')
  await world.clock.advance(1499)
  expect(world.toasts).toEqual([])
  await world.clock.advance(1)
  expect(world.toasts).toEqual([MESSAGES.notice(2)])
  await describeCommand($, 'Another untranslated command', BUILTIN, 'another')
  await world.clock.advance(5000)
  expect(world.toasts.length).toBe(1)
  expect(world.saved.get('notified')).toEqual([`commands:${CLEAR_EN}`, 'config:Sample setting'])
})

test('이미 알린 문구만 있으면 알림을 표시하지 않습니다', async ($, on) => {
  const world = setupWorld(on, { store: { notified: [`commands:${CLEAR_EN}`] } })
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await world.clock.advance(1500)
  expect(world.toasts).toEqual([])
})

test('미번역 알림을 끄면 알림을 표시하지 않습니다', { options: { notify_untranslated: false } }, async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, CLEAR_EN, BUILTIN, 'clear')
  await world.clock.advance(1500)
  expect(world.toasts).toEqual([])
})

test('번역을 꺼 둔 다른 플러그인의 미번역 문구는 알리지 않습니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, OTHER_EN, OTHER, 'deploy')
  await world.clock.advance(1500)
  expect(world.toasts).toEqual([])
})
