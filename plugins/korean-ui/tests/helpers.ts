// 여러 테스트 파일이 함께 쓰는 가짜 응답(stub)과 시험용 문구입니다.
// 공식 테스트 도구의 규칙에 따라, 각 테스트에서 첫 $ 호출보다 먼저 setupWorld를 부릅니다.
import type { On } from 'claude-code'
import { mock, type Engine } from 'claude-code/testing'

export const BUILTIN = { plugin: 'engine', tier: 'core' } as const
// 0단계에서 다른 플러그인의 제공자 이름이 '이름@마켓플레이스' 형식인 것을 확인했습니다.
export const OTHER = { plugin: 'other-plugin@market', tier: 'user' } as const
export const SELF = { plugin: 'korean-ui@korean-ui', tier: 'user' } as const
export const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

export const HELP_EN = 'Show help and available commands'
export const HELP_KO = '도움말과 사용 가능한 명령어를 표시합니다'
export const CLEAR_EN = 'Start a new session with empty context; previous session stays on disk (resumable with /resume)'
export const CLEAR_KO = '빈 컨텍스트로 새 세션을 시작합니다. 이전 세션은 디스크에 유지됩니다(/resume으로 이어서 진행할 수 있습니다)'
export const OTHER_EN = 'Deploy the current branch to staging'
export const OTHER_KO = '현재 브랜치를 스테이징 환경에 배포합니다'
export const MODEL_EN = 'Set the AI model for Claude Code'
export const MODEL_KO = 'Claude Code의 AI 모델을 설정합니다'
export const BUNDLED = JSON.stringify({ commands: { [HELP_EN]: HELP_KO, [MODEL_EN]: MODEL_KO }, config: { Theme: '테마' } })
export const GUIDE = '# 시험용 번역 지침'
export const VERSION = '0.1.1'
export const PLUGIN_JSON = JSON.stringify({ name: 'korean-ui', version: VERSION })

type Provider = { plugin: string; tier: string }

// 가짜 응답이 받은 값을 모아 두는 곳입니다. 테스트에서 저장, 알림, 파일 쓰기, Haiku 요청 내용을 확인할 때 씁니다.
export type World = {
  saved: Map<string, unknown>
  toasts: string[]
  written: { path: string; text: string }[]
  prompts: string[]
  registered: unknown[]
  clock: ReturnType<typeof mock.clock>
}

export type WorldOptions = {
  store?: Record<string, unknown>
  // 경로의 끝부분과 그 파일의 내용입니다. null이면 읽기가 실패합니다.
  files?: Record<string, string | null>
  // $.model.complete가 차례로 돌려줄 가짜 응답입니다. 함수이면 호출해서 그 결과를 돌려줍니다.
  replies?: unknown[]
  storeSetFails?: boolean
  // 이 키에 저장할 때만 실패합니다.
  storeSetFailsFor?: string[]
  writeFails?: boolean
  // $.session.cwd가 돌려줄 작업 폴더입니다. 정하지 않으면 '/work'입니다.
  cwd?: string
}

// Claude Code가 대답해야 하는 자리를 모두 가짜 응답으로 채우고, 테스트에서 확인할 기록을 돌려줍니다.
export function setupWorld(on: On, options: WorldOptions = {}): World {
  const files = options.files ?? {
    'locales/ko.json': BUNDLED,
    'locales/ko-guide.md': GUIDE,
    '.claude-plugin/plugin.json': PLUGIN_JSON,
  }
  const replies = [...(options.replies ?? [])]
  const world: World = {
    saved: new Map(Object.entries(options.store ?? {})),
    toasts: [],
    written: [],
    prompts: [],
    registered: [],
    clock: mock.clock(on),
  }

  on('fs.read', ($, e) => {
    const path = e.path.replaceAll('\\', '/')
    const match = Object.entries(files).find(([suffix]) => path.endsWith(suffix))
    if (match === undefined || match[1] === null) return { deny: `no such file: ${path}` }
    return { value: match[1] }
  })
  on('fs.write', ($, e) => {
    if (options.writeFails === true) return { deny: 'disk full' }
    world.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('store.get', ($, e) => ({ value: world.saved.get(e.key) }))
  on('store.set', ($, e) => {
    if (options.storeSetFails === true || options.storeSetFailsFor?.includes(e.key) === true) return { deny: 'store is full' }
    world.saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    world.registered.push(e)
    return { value: undefined }
  })
  on('command.list', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('session.cwd', () => ({ value: options.cwd ?? '/work' }))
  on('session.start', () => ({ cwd: '/work' }))
  on('model.complete', ($, e) => {
    world.prompts.push(String(e.prompt))
    const next = replies.shift()
    if (typeof next === 'function') return (next as () => unknown)()
    return next ?? answer({})
  })
  on('command.describe', ($, e) => ({ description: e.description, argumentHint: e.argumentHint, isHidden: e.isHidden }))
  on('config.describe', ($, e) => ({ label: e.label, description: e.description, isHidden: e.isHidden }))
  on('prompt.attachment', ($, e) => ({ text: e.text }))
  return world
}

// Haiku가 번호별 번역문을 JSON 객체로 대답한 것처럼 만드는 가짜 응답입니다.
export function answer(translations: Record<string, string>) {
  return { value: { isAnswered: true, text: JSON.stringify(translations), usage: USAGE } }
}

// Haiku가 주어진 문장을 그대로 대답한 것처럼 만드는 가짜 응답입니다.
export function rawAnswer(text: string) {
  return { value: { isAnswered: true, text, usage: USAGE } }
}

// Haiku 호출이 API 오류로 실패한 것처럼 만드는 가짜 응답입니다.
export function apiError(status: number) {
  return { value: { isAnswered: false, reason: 'api-error', status, error: { kind: 'overloaded' }, usage: USAGE } }
}

// Claude Code가 메뉴에 명령어를 표시하기 직전의 이벤트를 발생시킵니다.
export function describeCommand($: Engine, description: string, provider: Provider = BUILTIN, command = 'help') {
  return $.command.describe({ command, description, isHidden: false, immediate: false, provider })
}

// Claude Code가 /config에 항목을 표시하기 직전의 이벤트를 발생시킵니다.
export function describeConfig($: Engine, label: string, provider: Provider = BUILTIN, key = 'theme', description?: string) {
  return $.config.describe({ key, label, isHidden: false, provider, ...(description === undefined ? {} : { description }) })
}

// 세션이 시작될 때의 이벤트를 발생시킵니다. isInteractive가 false이면 -p 실행처럼 화면 없이 시작합니다.
export function startSession($: Engine, isInteractive = true) {
  return $.session.start({ surface: isInteractive ? 'terminal' : null, isInteractive, cwd: '/work' })
}

// Claude Code가 Claude에게 스킬 목록을 보내기 직전의 이벤트를 발생시킵니다.
export function sendListing($: Engine, text: string) {
  return $.prompt.attachment({ type: 'skill_listing', text, origin: { kind: 'engine' } })
}
