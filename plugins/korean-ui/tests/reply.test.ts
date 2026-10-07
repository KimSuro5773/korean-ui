import { expect, test } from 'claude-code/testing'
import {
  buildNamedReverse,
  buildPrompt,
  buildReverse,
  originalOf,
  parseReply,
  protectedTokens,
  restoreListing,
  validateReply,
} from '../hooks/lib/translation.ts'

const CLEAR_EN = 'Start a new session with empty context; previous session stays on disk (resumable with /resume)'
const CLEAR_KO = '빈 컨텍스트로 새 세션을 시작합니다. 이전 세션은 디스크에 유지됩니다(/resume으로 이어서 진행할 수 있습니다)'

test('protectedTokens는 명령어, 옵션, 백틱 코드를 찾습니다', () => {
  expect(protectedTokens(CLEAR_EN)).toEqual(['/resume'])
  expect(protectedTokens('Run `npm test` with --watch, then /compact')).toEqual(['`npm test`', '/compact', '--watch'])
})

test('protectedTokens는 경로, 주소, and/or를 명령어로 보지 않습니다', () => {
  expect(protectedTokens('Edit ~/.claude/settings.json and/or open https://example.com/docs')).toEqual([])
})

test('parseReply는 코드 블록을 벗겨 내고 객체만 받아들입니다', () => {
  expect(parseReply('{"1": "가"}')).toEqual({ '1': '가' })
  expect(parseReply('```json\n{"1": "가"}\n```')).toEqual({ '1': '가' })
  expect(parseReply('번역할 수 없습니다')).toBeUndefined()
  expect(parseReply('["가"]')).toBeUndefined()
})

test('validateReply는 번호로 번역문을 찾고 조건에 맞는 것만 받아들입니다', () => {
  const batch = [CLEAR_EN, 'Show help', 'Open settings', 'Exit']
  const reply = JSON.stringify({ '1': CLEAR_KO, '2': '도움말을\n표시합니다', '3': '   ' })
  expect(validateReply(batch, reply)).toEqual({
    accepted: { [CLEAR_EN]: CLEAR_KO },
    rejected: ['Show help', 'Open settings', 'Exit'],
  })
})

test('validateReply는 보존해야 할 부분이 빠진 번역문을 거부합니다', () => {
  const reply = JSON.stringify({ '1': '빈 컨텍스트로 새 세션을 시작합니다.' })
  expect(validateReply([CLEAR_EN], reply)).toEqual({ accepted: {}, rejected: [CLEAR_EN] })
})

test('validateReply는 원문을 키로 쓴 응답을 받아들이지 않습니다', () => {
  expect(validateReply(['Show help'], JSON.stringify({ 'Show help': '도움말을 표시합니다' })).rejected).toEqual(['Show help'])
})

test('validateReply는 응답이 JSON이 아니면 모두 거부합니다', () => {
  expect(validateReply(['A', 'B'], 'not json')).toEqual({ accepted: {}, rejected: ['A', 'B'] })
})

test('buildPrompt는 번호를 붙인 원문과 응답 형식을 담습니다', () => {
  const prompt = buildPrompt('commands', ['Show help', 'Exit'])
  expect(prompt).toContain('"id": "1"')
  expect(prompt).toContain('"text": "Show help"')
  expect(prompt).toContain('"id": "2"')
  expect(prompt).toContain('id를 키로, 번역문을 값으로 하는 JSON 객체 하나만 출력하세요')
  expect(buildPrompt('config', ['Theme'])).toContain('/config 설정 항목')
})

const REVERSE = new Map([
  ['사용자가 요청할 때 사용합니다', 'Use when the user asks'],
  ['Claude Code의 AI 모델을 설정합니다', 'Set the AI model for Claude Code'],
])
const HEADER = 'The following skills are available for use with the Skill tool:'

test('buildReverse는 번역문으로 원문을 찾게 하고 기본 번역표를 우선합니다', () => {
  const bundled = { commands: { A: '가' }, config: { Theme: '테마' } }
  const user = { commands: { B: '나', C: '가' }, config: {} }
  expect([...buildReverse(bundled, user)].sort()).toEqual([
    ['가', 'A'],
    ['나', 'B'],
  ])
})

test('originalOf는 번역문, 잘린 번역문, (현재 …)가 붙은 번역문의 원문을 찾습니다', () => {
  expect(originalOf('사용자가 요청할 때 사용합니다', REVERSE)).toBe('Use when the user asks')
  expect(originalOf('사용자가 요청할…', REVERSE)).toBe('Use when the user asks')
  expect(originalOf('Claude Code의 AI 모델을 설정합니다(현재 Opus 5.5)', REVERSE)).toBe(
    'Set the AI model for Claude Code (currently Opus 5.5)',
  )
  expect(originalOf('직접 만든 한국어 스킬입니다', REVERSE)).toBeUndefined()
  expect(originalOf('…', REVERSE)).toBeUndefined()
})

test('restoreListing은 번역문이 들어간 줄만 영어 원문으로 되돌립니다', () => {
  const text = [HEADER, '', '- kui:skill: 사용자가 요청할 때 사용합니다', '- other: Other skill', '- mine: 직접 만든 한국어 스킬입니다'].join(
    '\n',
  )
  expect(restoreListing(text, REVERSE, new Map())).toEqual({
    text: [HEADER, '', '- kui:skill: Use when the user asks', '- other: Other skill', '- mine: 직접 만든 한국어 스킬입니다'].join('\n'),
    restored: 1,
    leftover: 0,
  })
})

test('restoreListing은 형식이 달라 되돌리지 못한 번역문의 개수를 셉니다', () => {
  const text = '* kui:skill — 사용자가 요청할 때 사용합니다'
  expect(restoreListing(text, REVERSE, new Map())).toEqual({ text, restored: 0, leftover: 1 })
})

test('restoreListing은 같은 번역문이 여러 원문에 있으면 줄의 명령어 이름으로 원문을 고릅니다', () => {
  const bundled = { commands: {}, config: {} }
  const user = { commands: { 'Run tests': '테스트를 실행합니다', 'Run the test suite': '테스트를 실행합니다' }, config: {} }
  const described = new Map([
    ['unit', 'Run tests'],
    ['suite', 'Run the test suite'],
  ])
  const text = '- unit: 테스트를 실행합니다\n- suite: 테스트를 실행합니다'
  expect(restoreListing(text, buildReverse(bundled, user), buildNamedReverse(described, bundled, user))).toEqual({
    text: '- unit: Run tests\n- suite: Run the test suite',
    restored: 2,
    leftover: 0,
  })
})

test('buildNamedReverse는 명령어마다 자기 번역문으로 원문을 찾고, (현재 …)가 달라도 원문을 찾습니다', () => {
  const bundled = { commands: { 'Set the AI model for Claude Code': 'Claude Code의 AI 모델을 설정합니다' }, config: {} }
  const user = { commands: {}, config: {} }
  const named = buildNamedReverse(new Map([['model', 'Set the AI model for Claude Code (currently Opus 5.5)']]), bundled, user)
  expect(originalOf('Claude Code의 AI 모델을 설정합니다(현재 Sonnet 5.5)', named.get('model') ?? new Map())).toBe(
    'Set the AI model for Claude Code (currently Sonnet 5.5)',
  )
})
