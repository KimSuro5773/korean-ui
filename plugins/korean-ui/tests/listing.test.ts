import { expect, test } from 'claude-code/testing'
import {
  HELP_EN,
  HELP_KO,
  MODEL_EN,
  MODEL_KO,
  OTHER,
  describeCommand,
  sendListing,
  setupWorld,
  startSession,
} from './helpers'

const HANGUL = /\p{Script=Hangul}/u
const SKILL_BODY = 'Show the help text for every command.'
const FALLBACK_LOG = (count: number) =>
  `스킬 목록에서 번역표에 없는 번역문 ${count}줄을 명령어 이름으로 찾은 영어 설명으로 바꿨습니다.`

test('스킬을 호출해도 Claude가 읽는 스킬 목록과 스킬 본문은 영어 원문입니다', async ($, on) => {
  setupWorld(on)
  await startSession($)
  expect((await describeCommand($, HELP_EN)).description).toBe(HELP_KO)
  const listing = await sendListing($, `- help: ${HELP_KO}`)
  expect(listing.text).toBe(`- help: ${HELP_EN}`)
  expect(HANGUL.test(listing.text ?? '')).toBe(false)
  expect((await $.skill.prompt({ skill: 'help', text: SKILL_BODY })).text).toBe(SKILL_BODY)
})

test('번역표에 없는 이전 번역문도 명령어 이름으로 영어 원문으로 되돌립니다', async ($, on) => {
  const world = setupWorld(on)
  await describeCommand($, HELP_EN)
  expect((await sendListing($, '- help: 이전 버전의 도움말 번역')).text).toBe(`- help: ${HELP_EN}`)
  expect(world.logs).toContain(FALLBACK_LOG(1))
})

test('명령어 이름으로 되돌릴 때 when_to_use는 그대로 남깁니다', async ($, on) => {
  setupWorld(on)
  await describeCommand($, HELP_EN)
  expect((await sendListing($, '- help: 이전 번역 - Use when the user needs help')).text).toBe(
    `- help: ${HELP_EN} - Use when the user needs help`,
  )
})

test('원래 한글이 든 설명은 바꾸지 않습니다', { options: { translate_others: true } }, async ($, on) => {
  setupWorld(on)
  await describeCommand($, '한국어로 쓴 원래 설명', OTHER, 'native')
  const text = '- native: 한국어로 쓴 원래 설명 - 한국어 사용 조건'
  expect((await sendListing($, text)).text).toBe(text)
})

test('영어 설명에 붙은 한국어 when_to_use는 그대로 남깁니다', async ($, on) => {
  setupWorld(on)
  await describeCommand($, 'Deploy the app', OTHER, 'deploy')
  const text = '- deploy: Deploy the app - 배포를 요청할 때 사용'
  expect((await sendListing($, text)).text).toBe(text)
})

test('원래 한국어 설명이 번역표의 번역문과 같아도 바꾸지 않습니다', async ($, on) => {
  setupWorld(on)
  await describeCommand($, HELP_KO, OTHER, 'my-help')
  const text = `- my-help: ${HELP_KO}\n- my-help: ${HELP_KO} - 사용자가 요청할 때`
  expect((await sendListing($, text)).text).toBe(text)
})

test('영어 설명의 기록이 없는 한글 줄은 그대로 두고 디버그 로그에 명령어 이름을 남깁니다', async ($, on) => {
  const world = setupWorld(on)
  expect((await sendListing($, `- help: 이전 번역\n- model: ${MODEL_KO}`)).text).toBe(`- help: 이전 번역\n- model: ${MODEL_EN}`)
  expect(world.logs).toContain('스킬 목록에서 영어 설명의 기록이 없어 되돌리지 못한 한글 줄이 있습니다: help')
})
