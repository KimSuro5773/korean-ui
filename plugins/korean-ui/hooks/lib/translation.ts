// 번역 사전을 읽고, 찾고, 합치는 함수들입니다.
// Claude Code API($)를 쓰지 않으므로 Claude Code 없이 테스트할 수 있습니다.

// 번역할 문구의 종류입니다. commands는 명령어 설명, config는 /config 항목입니다.
export type Kind = 'commands' | 'config'
export const KINDS: readonly Kind[] = ['commands', 'config']

// 항목을 누가 제공했는지 나타냅니다. builtin은 Claude Code, others는 다른 플러그인, self는 이 플러그인입니다.
export type Category = 'builtin' | 'others' | 'self'

// 영어 원문을 키로, 한국어 번역문을 값으로 저장합니다. 명령어 설명과 /config 항목을 나누어 저장합니다.
export type Dictionary = Record<Kind, Record<string, string>>

// /config에서 켜고 끄는 세 항목의 값입니다.
export type Settings = {
  translateBuiltin: boolean
  translateOthers: boolean
  notifyUntranslated: boolean
}

// 화면에 표시된 영어 원문과, 그 원문을 누가 제공했는지 기록합니다.
export type Seen = Record<Kind, Map<string, Category>>

// 번역 명령어가 번역한 개수와 실패한 개수입니다.
export type Counts = { commands: number; config: number; failed: number }

// 내보내기 결과입니다. json은 파일 내용, missing은 번역문이 없는 기본 항목 수, builtinCount는 확인한 기본 항목 수입니다.
export type ExportResult = { json: string; missing: number; builtinCount: number }

// 사용자에게 보여 주는 문구입니다.
export const MESSAGES = {
  commandDescription: '번역되지 않은 명령어 설명과 설정 항목을 Haiku로 번역합니다',
  nothing: '번역할 문구가 없습니다.',
  noCategory: "번역 항목이 모두 꺼져 있습니다. /config에서 '기본 항목 번역'이나 '다른 플러그인과 스킬 번역'을 켜 주세요.",
  othersHint: '다른 플러그인과 스킬도 번역하려면 /config에서 해당 항목을 켠 뒤 다시 실행하세요.',
  usage:
    '사용법: /korean-ui-translate는 번역되지 않은 문구를 번역하고, /korean-ui-translate export는 기본 항목의 번역을 파일로 내보냅니다.',
  exportNothingSeen:
    '아직 확인한 기본 항목이 없어서 내보내지 않았습니다. 입력창에 /를 입력해 명령어 목록을 한 번 연 뒤 다시 실행하세요.',
  guideFailed: (reason: string) =>
    `번역 지침 파일(locales/ko-guide.md)을 읽지 못해서 번역을 시작하지 않았습니다. 원인: ${reason}`,
  modelFailed: (reason: string) =>
    `Haiku 호출에 실패해서 번역을 중단했습니다. 원인: ${reason}. 이미 저장한 번역은 그대로 유지됩니다.`,
  storeFailed: (reason: string) =>
    `번역 결과를 저장하지 못해서 번역을 중단했습니다. 원인: ${reason}. 기존 번역 사전은 그대로 유지됩니다.`,
  exported: (path: string, missing: number) =>
    `기본 항목의 번역을 ${path}에 저장했습니다. 번역문이 없는 기본 항목은 ${missing}개입니다.`,
  exportFailed: (reason: string, path: string) => `내보내기 파일을 저장하지 못했습니다. 원인: ${reason}. 저장하려던 경로: ${path}`,
  notice: (count: number) => `번역되지 않은 문구가 ${count}개 있습니다. /korean-ui-translate를 실행하면 번역합니다.`,
} as const

// 빈 번역 사전을 만듭니다.
export function emptyDictionary(): Dictionary {
  return { commands: {}, config: {} }
}

// 화면에 표시된 원문을 기록할 빈 목록을 만듭니다.
export function emptySeen(): Seen {
  return { commands: new Map(), config: new Map() }
}

// /config에서 고른 값을 읽습니다. 값이 없으면 plugin.json의 기본값을 씁니다.
export function readSettings(options: Readonly<Record<string, unknown>>): Settings {
  return {
    translateBuiltin: options['translate_builtin'] !== false,
    translateOthers: options['translate_others'] === true,
    notifyUntranslated: options['notify_untranslated'] !== false,
  }
}

// 파일이나 저장소에서 읽은 값을 번역 사전으로 바꿉니다. 형식이 잘못된 항목은 버립니다.
export function parseDictionary(raw: unknown): Dictionary {
  const result = emptyDictionary()
  if (typeof raw !== 'object' || raw === null) return result
  for (const kind of KINDS) {
    const section: unknown = (raw as Record<string, unknown>)[kind]
    if (typeof section !== 'object' || section === null || Array.isArray(section)) continue
    for (const [source, translated] of Object.entries(section)) {
      if (typeof translated === 'string' && translated.trim() !== '') result[kind][source] = translated
    }
  }
  return result
}

// 항목을 Claude Code, 다른 플러그인, 이 플러그인 중 누가 제공했는지 판별합니다.
export function categoryOf(providerPlugin: string, selfName: string): Category {
  if (providerPlugin === 'engine') return 'builtin'
  if (pluginBase(providerPlugin) === pluginBase(selfName)) return 'self'
  return 'others'
}

// 'korean-ui@korean-ui'처럼 플러그인 이름 뒤에 붙은 '@마켓플레이스'를 뗍니다.
function pluginBase(name: string): string {
  const at = name.indexOf('@')
  return at === -1 ? name : name.slice(0, at)
}

const CURRENTLY = /^(.*\S) \(currently (.+)\)$/

// 설명 끝의 ' (currently Opus 5.5)' 같은 현재 상태 표시를 떼어 냅니다. 상태가 바뀌어도 같은 번역문을 찾기 위해서입니다.
export function splitState(source: string): { base: string; state: string | undefined } {
  const match = CURRENTLY.exec(source)
  if (match === null) return { base: source, state: undefined }
  return { base: match[1] ?? source, state: match[2] }
}

// 번역문 뒤에 떼어 냈던 현재 상태를 '(현재 Opus 5.5)'처럼 붙입니다.
export function withState(translated: string, state: string | undefined): string {
  return state === undefined ? translated : `${translated}(현재 ${state})`
}

// 이 항목을 번역하도록 /config에서 켜 두었는지 확인합니다.
export function isEnabled(category: Category, settings: Settings): boolean {
  if (category === 'builtin') return settings.translateBuiltin
  if (category === 'others') return settings.translateOthers
  return false
}

const HANGUL = /\p{Script=Hangul}/u

// 번역할 문구인지 확인합니다. 비어 있거나 이미 한글이 들어 있으면 번역하지 않습니다.
export function needsTranslation(source: string): boolean {
  return source.trim() !== '' && !HANGUL.test(source)
}

// 영어 원문의 번역문을 찾습니다. 기본 번역표를 먼저 찾고, 없으면 사용자 번역 사전을 찾습니다.
export function lookup(bundled: Dictionary, user: Dictionary, kind: Kind, source: string): string | undefined {
  if (Object.hasOwn(bundled[kind], source)) return bundled[kind][source]
  if (Object.hasOwn(user[kind], source)) return user[kind][source]
  return undefined
}

// 화면에 표시된 원문을 기록합니다. Claude Code도 같은 원문을 쓰면 Claude Code 항목으로 남겨서 내보내기에서 빠지지 않게 합니다.
export function recordSeen(seen: Seen, kind: Kind, source: string, category: Category): void {
  if (seen[kind].get(source) === 'builtin') return
  seen[kind].set(source, category)
}

// 번역하도록 켜 둔 항목 중에서 아직 번역문이 없는 원문을 정렬해서 돌려줍니다.
export function untranslated(seen: Seen, settings: Settings, bundled: Dictionary, user: Dictionary): Record<Kind, string[]> {
  const result: Record<Kind, string[]> = { commands: [], config: [] }
  for (const kind of KINDS) {
    for (const [source, category] of seen[kind]) {
      if (isEnabled(category, settings) && lookup(bundled, user, kind, source) === undefined) result[kind].push(source)
    }
    result[kind].sort()
  }
  return result
}

// Haiku에 한 번에 보낼 원문을 50개, 6000자 이하로 나눕니다. 응답이 너무 길어져 잘리지 않게 하기 위해서입니다.
export function makeBatches(sources: readonly string[], maxItems = 50, maxChars = 6000): string[][] {
  const batches: string[][] = []
  let current: string[] = []
  let chars = 0
  for (const source of sources) {
    if (current.length > 0 && (current.length >= maxItems || chars + source.length > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(source)
    chars += source.length
  }
  if (current.length > 0) batches.push(current)
  return batches
}

// 번역 사전에 새 번역문을 더한 사본을 만듭니다. 원래 사전은 바꾸지 않습니다.
export function withTranslations(dictionary: Dictionary, kind: Kind, additions: Readonly<Record<string, string>>): Dictionary {
  const next: Dictionary = { commands: { ...dictionary.commands }, config: { ...dictionary.config } }
  next[kind] = { ...next[kind], ...additions }
  return next
}

// 화면에서 확인한 Claude Code 기본 항목의 번역문을 모아 기본 번역표(ko.json)와 같은 형식의 JSON으로 만듭니다.
export function buildExport(seen: Seen, bundled: Dictionary, user: Dictionary): ExportResult {
  const out = emptyDictionary()
  let missing = 0
  let builtinCount = 0
  for (const kind of KINDS) {
    const sources = [...seen[kind]]
      .filter(([, category]) => category === 'builtin')
      .map(([source]) => source)
      .sort()
    for (const source of sources) {
      builtinCount += 1
      const translated = lookup(bundled, user, kind, source)
      if (translated === undefined) missing += 1
      else out[kind][source] = translated
    }
  }
  return { json: `${JSON.stringify(out, null, 2)}\n`, missing, builtinCount }
}

// 이미 알린 문구를 기록할 때 쓰는 키를 만듭니다. 명령어 설명과 /config 항목을 구분하려고 종류를 앞에 붙입니다.
export function noticeKey(kind: Kind, source: string): string {
  return `${kind}:${source}`
}

// 오류에서 사용자에게 보여 줄 메시지를 꺼냅니다.
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 번역 명령어의 실행 결과를 한 문장으로 요약합니다.
export function summaryText(counts: Counts): string {
  const done = `명령어 설명 ${counts.commands}개, 설정 항목 ${counts.config}개를 번역했습니다.`
  return counts.failed > 0 ? `${done} 실패한 ${counts.failed}개는 다음에 실행할 때 다시 번역합니다.` : done
}

// 다른 플러그인과 스킬의 번역이 꺼져 있으면, 켜는 방법을 안내하는 문장을 덧붙입니다.
export function withOthersHint(text: string, settings: Settings): string {
  return settings.translateOthers ? text : `${text} ${MESSAGES.othersHint}`
}

// Haiku 호출이 실패한 원인을 사용자에게 보여 줄 한국어로 바꿉니다.
export function failureReason(reason: string, status: number | null | undefined): string {
  if (reason === 'api-error') return `API 오류(상태 코드 ${status ?? '없음'})`
  if (reason === 'aborted') return '호출이 중단됨'
  return reason
}
