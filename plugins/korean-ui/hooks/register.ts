import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'
import {
  type SourceSet,
  countSkipped,
  countStored,
  hasFailures,
  matchProvider,
  providerRows,
  providersOf,
  restrictTo,
  sourcesOf,
  statusText,
  unseenStored,
  withoutFailures,
  withoutSources,
} from './lib/catalog.ts'
import {
  type Counts,
  type Dictionary,
  type FailedItem,
  type Failures,
  type Kind,
  type Layers,
  type PromptItem,
  type Retired,
  type Seen,
  type Settings,
  KINDS,
  MESSAGES,
  buildExport,
  buildNamedReverse,
  buildPrompt,
  buildReverse,
  categoryOf,
  countEntries,
  countedFailures,
  emptyDictionary,
  emptySeen,
  failedListText,
  failureReason,
  isEnabled,
  isSkipped,
  lookup,
  makeBatches,
  messageOf,
  needsTranslation,
  noticeKey,
  parseDictionary,
  parseFailures,
  parseNotified,
  promptItems,
  providerLabel,
  readSettings,
  recordSeen,
  rejectAll,
  restoreListing,
  retireRemoved,
  skippedCount,
  skippedText,
  splitSkipped,
  splitState,
  summaryText,
  untranslated,
  validateReply,
  versionOf,
  withFailures,
  withOthersHint,
  withState,
  withTranslations,
} from './lib/translation.ts'

const STORE_DICTIONARY = 'dictionary'
const STORE_OVERRIDES = 'overrides'
const STORE_NOTIFIED = 'notified'
const STORE_FAILURES = 'failures'
const EXPORT_FILE = 'korean-ui-ko.json'
const NOTICE_DELAY_MS = 1500

// 처음 필요할 때 한 번 읽어 두는 값입니다. overrides는 요청으로 고친 번역, user는 자동 번역, notified는 이미 알린 문구의 목록입니다.
// overrides, user, notified는 다른 세션이 바꿀 수 있으므로, 번역하거나 알림을 띄우기 직전에 저장소에서 다시 읽습니다.
// retired는 overrides와 user에서 빠진 이전 번역문으로, 스킬 목록을 되돌릴 때만 씁니다.
type Loaded = {
  bundled: Dictionary
  overrides: Dictionary
  user: Dictionary
  notified: Set<string>
  retired: Retired
}

// 플러그인이 한 번 로드된 동안 유지하는 상태입니다. /config 값을 바꾸면 플러그인이 다시 로드되어 새로 만들어집니다.
type State = {
  settings: Settings
  seen: Seen
  loading: Promise<Loaded> | undefined
  loaded: Loaded | undefined
  noticeScheduled: boolean
  // session.start에서 받은 값으로, 사람이 입력창 앞에 있는지 나타냅니다. -p 실행과 SDK에서는 false이고, 세션 시작 전에는 undefined입니다.
  interactive: boolean | undefined
  // command.describe에서 받은 명령어 이름과 영어 설명입니다. 스킬 목록을 되돌릴 때 줄마다 자기 원문을 찾는 데 씁니다.
  described: Map<string, string>
}

// Haiku에 한 번 요청한 결과입니다. failed는 번역에 실패한 원문과 그 이유이고, stopped가 있으면 그 이유를 보여 주고 번역을 멈춥니다.
type BatchOutcome = { saved: number; failed: FailedItem[]; stopped?: string }

// Claude Code가 플러그인을 불러올 때 부르는 함수입니다. 화면 문구를 바꾸는 이벤트 처리와 번역 명령어를 등록합니다.
export const register: Register = (on, options) => {
  const state: State = {
    settings: readSettings(options),
    seen: emptySeen(),
    loading: undefined,
    loaded: undefined,
    noticeScheduled: false,
    interactive: undefined,
    described: new Map(),
  }

  // 세션이 시작되면 번역 명령어와 번역 지우기 명령어를 등록합니다.
  // 사람이 입력창 앞에 있는지 기록해서, -p 실행에서는 미번역 알림을 띄우지 않게 합니다.
  // 다시 로드된 뒤에는 Claude Code가 저장해 둔 이전 표시 결과를 지워서, 바뀐 설정이 바로 반영되게 합니다.
  // 정적 검사가 등록한 명령어와 처리하는 명령어를 맞춰 볼 수 있도록, 명령어 이름은 상수 대신 그대로 적습니다.
  on('session.start', async ($, e, next) => {
    state.interactive = e.isInteractive
    try {
      await $.command.register({ name: 'korean-ui-translate', description: MESSAGES.commandDescription })
    } catch (error) {
      $.ui.log(`번역 명령어를 등록하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({
        name: 'korean-ui-reset',
        description: MESSAGES.resetDescription,
        argumentHint: MESSAGES.resetHint,
      })
    } catch (error) {
      $.ui.log(`번역 지우기 명령어를 등록하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    }
    try {
      await $.command.register({ name: 'korean-ui-status', description: MESSAGES.statusDescription })
    } catch (error) {
      $.ui.log(`상태 확인 명령어를 등록하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    }
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
    return next(e)
  })

  // 메뉴와 /help에 표시할 명령어 설명을 한국어로 바꿉니다.
  on('command.describe', async ($, e, next) => {
    state.described.set(e.command, e.description)
    const description = await translateText($, state, 'commands', e.provider.plugin, `/${e.command}`, e.description)
    return description === undefined ? next(e) : next({ ...e, description })
  })

  // Claude에게 보내기 직전의 스킬 목록에서 번역문을 영어 원문으로 되돌립니다.
  // 번역을 끈 뒤에도 Claude Code가 이전에 만든 목록을 다시 쓰는 경우가 있으므로, 설정과 관계없이 번역 사전을 기준으로 되돌립니다.
  // 되돌린 줄 수를 디버그 로그에 남겨서, 명령어 이름으로 원문을 찾았는지 확인할 수 있게 합니다.
  on('prompt.attachment', { type: 'skill_listing' }, async ($, e, next) => {
    const loaded = await ensureLoaded($, state)
    const layers = layersOf(loaded)
    const result = restoreListing(
      e.text,
      buildReverse(layers, loaded.retired),
      buildNamedReverse(state.described, layers, loaded.retired),
    )
    if (result.restored > 0) {
      $.ui.log(
        `스킬 목록에서 설명 ${result.restored}줄을 영어 원문으로 되돌렸습니다(명령어 이름으로 찾은 줄 ${result.byName}개, 사전 전체에서 찾은 줄 ${result.restored - result.byName}개).`,
        { to: 'debug' },
      )
    }
    if (result.leftover > 0) {
      $.ui.log(`스킬 목록을 되돌린 뒤에도 번역문 ${result.leftover}개가 남아 있습니다. 목록 형식이 바뀌었을 수 있습니다.`, {
        to: 'debug',
      })
    }
    return result.restored > 0 ? next({ ...e, text: result.text }) : next(e)
  })

  // /config에 표시할 항목 이름과 도움말을 한국어로 바꿉니다.
  on('config.describe', async ($, e, next) => {
    const label = await translateText($, state, 'config', e.provider.plugin, e.key, e.label)
    const description =
      e.description === undefined ? undefined : await translateText($, state, 'config', e.provider.plugin, e.key, e.description)
    if (label === undefined && description === undefined) return next(e)
    return next({ ...e, label: label ?? e.label, description: description ?? e.description })
  })

  // /korean-ui-translate를 실행했을 때의 처리입니다. 인자가 없으면 번역하고, export이면 기본 항목의 번역을 파일로 내보내며,
  // 알 수 없는 인자이면 사용법을 보여 줍니다.
  on('command.run', { command: 'korean-ui-translate' }, async ($, e) => {
    const argument = e.args.trim()
    if (argument === '') return { text: await runTranslate($, state) }
    if (argument === 'export') return { text: await runExport($, state) }
    return { text: MESSAGES.usage }
  })

  // /korean-ui-reset을 실행했을 때의 처리입니다. 확인을 받은 뒤 Haiku 번역과 실패 횟수를 지웁니다.
  // 인자로 제공자 이름을 받으면 그 제공자의 번역만 지웁니다.
  on('command.run', { command: 'korean-ui-reset' }, async ($, e) => ({ text: await runReset($, state, e.args.trim()) }))

  // /korean-ui-status를 실행했을 때의 처리입니다. Haiku를 호출하지 않고 번역 현황을 보여 줍니다. 인자는 쓰지 않습니다.
  on('command.run', { command: 'korean-ui-status' }, async ($) => ({ text: await runStatus($, state) }))
}

// 화면에 표시할 문구의 번역문을 찾습니다. 번역하지 않는 문구이거나 번역문이 없으면 undefined를 돌려줍니다.
// 번역문이 없으면 미번역 알림을 예약합니다. name은 그 문구가 붙은 명령어 이름('/commit')이나 /config 항목의 key입니다.
async function translateText(
  $: EngineInterface,
  state: State,
  kind: Kind,
  providerPlugin: string,
  name: string,
  source: string,
): Promise<string | undefined> {
  const category = categoryOf(providerPlugin, $.plugin.name)
  const { base, state: current } = splitState(source)
  if (category === 'self' || !needsTranslation(base)) return undefined
  recordSeen(state.seen, kind, base, category, name, providerLabel(providerPlugin))
  if (!isEnabled(category, state.settings)) return undefined
  const loaded = await ensureLoaded($, state)
  const translated = lookup(layersOf(loaded), kind, base)
  if (translated === undefined) {
    scheduleNotice($, state)
    return undefined
  }
  return withState(translated, current)
}

// 기본 번역표, 고친 번역, 자동 번역, 알림 기록을 처음 한 번만 읽고, 그다음부터는 읽어 둔 값을 씁니다.
function ensureLoaded($: EngineInterface, state: State): Promise<Loaded> {
  state.loading ??= loadAll($, state)
  return state.loading
}

// 읽어 둔 값에서 번역문을 찾는 세 계층을 꺼냅니다.
function layersOf(loaded: Loaded): Layers {
  return { overrides: loaded.overrides, bundled: loaded.bundled, user: loaded.user }
}

// 기본 번역표, 고친 번역, 자동 번역, 알림 기록을 읽고 상태에 보관합니다.
async function loadAll($: EngineInterface, state: State): Promise<Loaded> {
  const loaded: Loaded = {
    bundled: await readBundled($),
    overrides: await readOverrides($),
    user: await readUser($),
    notified: await readNotified($),
    retired: new Map(),
  }
  state.loaded = loaded
  return loaded
}

// 플러그인 폴더의 기본 번역표를 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readBundled($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(JSON.parse(await $.fs.read(`${$.plugin.root}/locales/ko.json`)))
  } catch (error) {
    $.ui.log(`기본 번역표를 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 저장소에서 요청으로 고친 번역을 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readOverrides($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(await $.store.get(STORE_OVERRIDES))
  } catch (error) {
    $.ui.log(`고친 번역을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 저장소에서 사용자 번역 사전을 읽습니다. 읽지 못하면 빈 사전으로 처리합니다.
async function readUser($: EngineInterface): Promise<Dictionary> {
  try {
    return parseDictionary(await $.store.get(STORE_DICTIONARY))
  } catch (error) {
    $.ui.log(`사용자 번역 사전을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return emptyDictionary()
  }
}

// 저장소에서 이미 알린 미번역 문구의 목록을 읽습니다. 읽지 못하면 빈 목록으로 처리합니다.
async function readNotified($: EngineInterface): Promise<Set<string>> {
  try {
    return new Set(parseNotified(await $.store.get(STORE_NOTIFIED)))
  } catch (error) {
    $.ui.log(`알림 기록을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return new Set()
  }
}

// 저장소에서 사용자 번역 사전과 고친 번역을 다시 읽어 메모리의 사본을 바꿉니다. 다른 세션이 저장한 번역을 쓰기 위해서이며,
// 읽지 못한 쪽은 사본을 그대로 씁니다.
async function refreshStored($: EngineInterface, loaded: Loaded): Promise<void> {
  try {
    const latest = parseDictionary(await $.store.get(STORE_DICTIONARY))
    retireRemoved(loaded.retired, loaded.user, latest)
    loaded.user = latest
  } catch (error) {
    $.ui.log(`사용자 번역 사전을 다시 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
  try {
    const latest = parseDictionary(await $.store.get(STORE_OVERRIDES))
    retireRemoved(loaded.retired, loaded.overrides, latest)
    loaded.overrides = latest
  } catch (error) {
    $.ui.log(`고친 번역을 다시 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
}

// 저장소에서 알림 기록을 다시 읽어 메모리의 기록에 더합니다. 다른 세션이 알린 문구를 다시 알리지 않기 위해서이며,
// 읽지 못하면 메모리의 기록을 그대로 씁니다.
async function refreshNotified($: EngineInterface, loaded: Loaded): Promise<void> {
  try {
    for (const key of parseNotified(await $.store.get(STORE_NOTIFIED))) loaded.notified.add(key)
  } catch (error) {
    $.ui.log(`알림 기록을 다시 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
}

// plugin.json에서 이 플러그인의 버전을 읽습니다. 읽지 못하면 실패 횟수를 쓰지 않도록 undefined를 돌려줍니다.
async function readVersion($: EngineInterface): Promise<string | undefined> {
  let version: string | undefined
  try {
    version = versionOf(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
  } catch (error) {
    $.ui.log(`플러그인 버전을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return undefined
  }
  if (version === undefined) $.ui.log('plugin.json에서 버전을 찾지 못했습니다.', { to: 'debug' })
  return version
}

// 저장소에서 실패 횟수를 읽습니다. 버전을 모르면 실패 횟수를 쓰지 않으므로 undefined를 돌려주고, 읽지 못하면 빈 기록으로 봅니다.
async function readFailures($: EngineInterface, version: string | undefined): Promise<Failures | undefined> {
  if (version === undefined) return undefined
  try {
    return parseFailures(await $.store.get(STORE_FAILURES), version)
  } catch (error) {
    $.ui.log(`실패 횟수를 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return { version, counts: {} }
  }
}

// Haiku에 한 번 요청한 결과를 실패 횟수에 반영하고, 이번에 횟수가 3 이상이 된 원문을 돌려줍니다.
// 다른 세션의 기록을 지우지 않도록 저장하기 직전에 다시 읽어서 반영하며, 저장하지 못해도 번역은 계속합니다.
async function recordFailures(
  $: EngineInterface,
  version: string | undefined,
  kind: Kind,
  succeeded: readonly string[],
  counted: readonly string[],
): Promise<Set<string>> {
  if (version === undefined) return new Set()
  try {
    const latest = parseFailures(await $.store.get(STORE_FAILURES), version)
    const hasCount = (source: string) => latest.counts[noticeKey(kind, source)] !== undefined
    if (counted.length === 0 && !succeeded.some(hasCount)) return new Set()
    const next = withFailures(latest, kind, succeeded, counted)
    await $.store.set(STORE_FAILURES, next)
    return new Set(counted.filter((source) => isSkipped(next, kind, source)))
  } catch (error) {
    $.ui.log(`실패 횟수를 저장하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
    return new Set()
  }
}

// 미번역 알림을 1.5초 뒤로 예약합니다. 명령어마다 따로 발생하는 이벤트를 기다렸다가 한 번에 세기 위해서이며,
// 플러그인이 로드된 동안 한 번만 예약합니다.
function scheduleNotice($: EngineInterface, state: State): void {
  if (!state.settings.notifyUntranslated || state.noticeScheduled) return
  state.noticeScheduled = true
  $.clock.after(NOTICE_DELAY_MS, () => showNotice($, state))
}

// 아직 알리지 않은 미번역 문구가 있으면 알림을 표시하고, 알린 문구를 저장합니다.
// 다른 세션이 그사이 번역하거나 알린 문구, 3번 실패해서 건너뛴 문구는 알리지 않도록 저장소를 다시 읽습니다.
// 사람이 입력창 앞에 없는 실행(-p, SDK)에서는 알림을 띄우지도, 기록하지도 않습니다.
// 알림 기록은 저장하기 직전에 가장 마지막으로 읽어서, 그사이 다른 세션이 저장한 기록을 덮어쓰지 않게 합니다.
async function showNotice($: EngineInterface, state: State): Promise<void> {
  const loaded = state.loaded
  if (loaded === undefined || state.interactive === false) return
  await refreshStored($, loaded)
  const failures = await readFailures($, await readVersion($))
  const { pending } = splitSkipped(untranslated(state.seen, state.settings, layersOf(loaded)), failures)
  await refreshNotified($, loaded)
  const keys = KINDS.flatMap((kind) => pending[kind].map((source) => noticeKey(kind, source)))
  const fresh = keys.filter((key) => !loaded.notified.has(key))
  if (fresh.length === 0) return
  $.ui.toast(MESSAGES.notice(keys.length), { timeoutMs: 8000 })
  for (const key of fresh) loaded.notified.add(key)
  $.store.set(STORE_NOTIFIED, [...loaded.notified]).catch((error: unknown) => {
    $.ui.log(`알림 기록을 저장하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  })
}

// 명령어 목록과 /config 목록을 한 번 읽습니다. 아직 화면에 표시되지 않은 항목의 원문도 기록하기 위해서입니다.
async function collectSources($: EngineInterface): Promise<void> {
  try {
    await $.command.list()
  } catch (error) {
    $.ui.log(`명령어 목록을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
  try {
    await $.config.list()
  } catch (error) {
    $.ui.log(`설정 목록을 읽지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
}

// 입력창 아래 상태 줄에 진행 상황을 표시합니다. undefined를 넘기면 표시를 지웁니다.
// 표시하지 못해도 번역은 계속하도록, 오류를 잡아서 디버그 로그에 남깁니다.
function showProgress($: EngineInterface, text: string | undefined): void {
  try {
    $.ui.status(text)
  } catch (error) {
    $.ui.log(`진행 상황을 표시하지 못했습니다: ${messageOf(error)}`, { to: 'debug' })
  }
}

// 번역문이 없는 문구를 Haiku로 번역해서 사용자 번역 사전에 저장하고, 결과를 요약한 문장을 돌려줍니다.
// 다른 세션이 저장한 번역을 쓰도록 시작할 때 사전을 다시 읽고, 끝나면 결과와 관계없이 메뉴를 다시 그리게 합니다.
// 3번 이상 실패한 문구는 보내지 않고, 건너뛴 수를 결과 끝에 알려 줍니다.
// 번역하는 동안 묶음 하나를 처리할 때마다 처리한 문구 수를 상태 줄에 표시하고, 끝나면 지웁니다.
// only가 있으면 그 원문만 번역하고, 다른 플러그인 번역 안내와 건너뛴 문구 안내는 붙이지 않습니다.
async function runTranslate($: EngineInterface, state: State, only?: SourceSet): Promise<string> {
  if (!state.settings.translateBuiltin && !state.settings.translateOthers) return MESSAGES.noCategory
  await collectSources($)
  const loaded = await ensureLoaded($, state)
  await refreshStored($, loaded)
  try {
    const version = await readVersion($)
    const failures = await readFailures($, version)
    const all = untranslated(state.seen, state.settings, layersOf(loaded))
    const { pending, skipped } = splitSkipped(only === undefined ? all : restrictTo(all, only), failures)
    const tail = only === undefined ? skippedText(skipped) : ''
    const withHint = (text: string) => (only === undefined ? withOthersHint(text, state.settings) : text)
    if (pending.commands.length + pending.config.length === 0) return `${withHint(MESSAGES.nothing)}${tail}`
    let guide: string
    try {
      guide = await $.fs.read(`${$.plugin.root}/locales/ko-guide.md`)
    } catch (error) {
      return MESSAGES.guideFailed(messageOf(error))
    }
    const counts: Counts = { commands: 0, config: 0, failed: 0, newlySkipped: 0 }
    const failed: FailedItem[] = []
    const total = pending.commands.length + pending.config.length
    let done = 0
    showProgress($, MESSAGES.progress(done, total))
    for (const kind of KINDS) {
      for (const batch of makeBatches(pending[kind])) {
        const outcome = await translateBatch($, loaded, guide, kind, promptItems(state.seen, kind, batch), version)
        if (outcome.stopped !== undefined) return `${summaryText(counts)} ${outcome.stopped}${failedListText(failed)}${tail}`
        counts[kind] += outcome.saved
        counts.failed += outcome.failed.length
        counts.newlySkipped += outcome.failed.filter((item) => item.newlySkipped === true).length
        failed.push(...outcome.failed)
        done += batch.length
        showProgress($, MESSAGES.progress(done, total))
      }
    }
    return `${withHint(summaryText(counts))}${failedListText(failed)}${tail}`
  } finally {
    showProgress($, undefined)
    $.ui.invalidate('command.describe')
    $.ui.invalidate('config.describe')
  }
}

// 원문 몇 개를 Haiku에 한 번 보내 번역하고, 검사를 통과한 번역문을 저장합니다. 결과는 실패 횟수에도 반영합니다.
// items는 원문에 이름과 제공자를 붙인 항목이고, 응답은 그 원문만 가지고 검사합니다.
async function translateBatch(
  $: EngineInterface,
  loaded: Loaded,
  guide: string,
  kind: Kind,
  items: readonly PromptItem[],
  version: string | undefined,
): Promise<BatchOutcome> {
  const batch = items.map((item) => item.source)
  let reply: ModelCompleteResult
  try {
    reply = await $.model.complete({ model: 'haiku', system: guide, prompt: buildPrompt(kind, items), maxTokens: 8192 })
  } catch (error) {
    return { saved: 0, failed: [], stopped: MESSAGES.modelFailed(messageOf(error)) }
  }
  if (!reply.isAnswered && reply.reason !== 'empty-reply') {
    const status = 'status' in reply ? reply.status : null
    return { saved: 0, failed: [], stopped: MESSAGES.modelFailed(failureReason(reply.reason, status)) }
  }
  const { accepted, rejected } = reply.isAnswered ? validateReply(batch, reply.text) : rejectAll(batch, { code: 'empty-reply' })
  const saved = Object.keys(accepted).length
  if (saved > 0) {
    try {
      await saveTranslations($, loaded, kind, accepted)
    } catch (error) {
      return { saved: 0, failed: [], stopped: MESSAGES.storeFailed(messageOf(error)) }
    }
  }
  const newlySkipped = await recordFailures($, version, kind, Object.keys(accepted), countedFailures(batch.length, rejected))
  return { saved, failed: rejected.map((item) => ({ ...item, newlySkipped: newlySkipped.has(item.source) })) }
}

// 번역문을 사용자 번역 사전에 저장합니다. 다른 세션이 그사이 저장한 번역을 지우지 않도록, 저장하기 직전에 저장소를 다시 읽어 합칩니다.
async function saveTranslations(
  $: EngineInterface,
  loaded: Loaded,
  kind: Kind,
  accepted: Readonly<Record<string, string>>,
): Promise<void> {
  const latest = parseDictionary(await $.store.get(STORE_DICTIONARY))
  const merged = withTranslations(latest, kind, accepted)
  await $.store.set(STORE_DICTIONARY, merged)
  retireRemoved(loaded.retired, loaded.user, merged)
  loaded.user = merged
}

// 화면에서 확인한 Claude Code 기본 항목의 번역을 기본 번역표와 같은 형식으로 현재 폴더에 저장합니다.
// 확인한 기본 항목이 하나도 없으면, 빈 파일로 기본 번역표를 잘못 교체하지 않도록 파일을 쓰지 않습니다.
// 다른 세션이 저장한 번역도 넣도록 사용자 번역 사전을 다시 읽습니다.
async function runExport($: EngineInterface, state: State): Promise<string> {
  await collectSources($)
  const loaded = await ensureLoaded($, state)
  await refreshStored($, loaded)
  const result = buildExport(state.seen, layersOf(loaded))
  if (result.builtinCount === 0) return MESSAGES.exportNothingSeen
  const cwd = await $.session.cwd()
  // Windows 작업 폴더이면 안내 문구의 경로가 섞여 보이지 않도록 역슬래시로 이어 붙입니다.
  const path = `${cwd}${cwd.includes('\\') ? '\\' : '/'}${EXPORT_FILE}`
  try {
    await $.fs.write(path, result.json)
  } catch (error) {
    return MESSAGES.exportFailed(messageOf(error), path)
  }
  return MESSAGES.exported(path, result.missing)
}

// 번역 현황을 보여 줄 글을 만듭니다. 명령어 목록과 /config 목록을 한 번 읽어 원문을 모은 뒤,
// 제공자별로 기본 번역표, 자동 번역, 고친 번역, 미번역, 건너뛰는 문구의 수를 셉니다.
// 다른 세션이 저장한 번역도 세도록 저장소를 다시 읽습니다.
async function runStatus($: EngineInterface, state: State): Promise<string> {
  await collectSources($)
  const loaded = await ensureLoaded($, state)
  await refreshStored($, loaded)
  const version = await readVersion($)
  const failures = await readFailures($, version)
  const layers = layersOf(loaded)
  return statusText(version, state.settings, providerRows(state.seen, layers, failures), unseenStored(state.seen, layers))
}

// /korean-ui-reset을 실행했을 때의 처리입니다. 인자가 없으면 Haiku로 번역한 문구를 모두 지우고,
// 제공자 이름이 있으면 그 제공자의 번역만 지웁니다.
function runReset($: EngineInterface, state: State, argument: string): Promise<string> {
  return argument === '' ? resetAll($, state) : resetProvider($, state, argument)
}

// 지울지 묻는 대화상자에서 고른 답입니다.
type ResetAnswer = 'remove' | 'retranslate'

// 지울지 묻는 대화상자를 띄우고 고른 답을 돌려줍니다.
// 취소했거나, 선택지와 다른 답을 입력했거나, 대화상자를 닫거나 띄울 수 없으면 undefined를 돌려줍니다.
async function askReset($: EngineInterface, question: string): Promise<ResetAnswer | undefined> {
  const { remove, retranslate, cancel } = MESSAGES.resetChoices
  try {
    const answer = await $.ui.ask(question, [remove, retranslate, cancel])
    if (answer === remove) return 'remove'
    return answer === retranslate ? 'retranslate' : undefined
  } catch {
    return undefined
  }
}

// 지운 결과를 한 문장으로 잇고, '지우고 다시 번역'을 골랐으면 이어서 번역한 결과를 붙입니다.
// only가 있으면 그 원문만 다시 번역합니다.
async function finishReset(
  $: EngineInterface,
  state: State,
  answer: ResetAnswer,
  parts: readonly string[],
  only?: SourceSet,
): Promise<string> {
  $.ui.invalidate('command.describe')
  $.ui.invalidate('config.describe')
  const done = parts.filter((part) => part !== '').join(' ')
  if (answer === 'remove') return `${done} ${MESSAGES.resetRetranslateHint}`
  return `${done}\n${await runTranslate($, state, only)}`
}

// Haiku로 번역한 문구(자동 번역과 고친 번역)와 실패 횟수를, 사용자에게 확인을 받은 뒤 저장소에서 지웁니다.
// 기본 번역표와 알림 기록은 지우지 않습니다. '지우고 다시 번역'을 고르면 지운 뒤 번역 명령어와 같은 번역을 실행합니다.
// 고친 번역이나 실패 횟수만 지우지 못하면, 지웠다고 하지 않고 남았다고 원인과 함께 알려 줍니다.
async function resetAll($: EngineInterface, state: State): Promise<string> {
  const loaded = await ensureLoaded($, state)
  await refreshStored($, loaded)
  const auto = countEntries(loaded.user)
  const fixed = countEntries(loaded.overrides)
  const skipped = skippedCount(await readFailures($, await readVersion($)))
  if (auto + fixed === 0 && skipped === 0) return MESSAGES.resetNothing
  const answer = await askReset($, MESSAGES.resetQuestion(auto + fixed, skipped))
  if (answer === undefined) return MESSAGES.resetCanceled
  try {
    await $.store.delete(STORE_DICTIONARY)
  } catch (error) {
    return MESSAGES.resetFailed(messageOf(error))
  }
  retireRemoved(loaded.retired, loaded.user, emptyDictionary())
  loaded.user = emptyDictionary()
  let removed = auto
  const notes: string[] = []
  try {
    await $.store.delete(STORE_OVERRIDES)
    retireRemoved(loaded.retired, loaded.overrides, emptyDictionary())
    loaded.overrides = emptyDictionary()
    removed += fixed
  } catch (error) {
    notes.push(MESSAGES.resetOverridesKept(messageOf(error)))
  }
  let skippedRemoved = skipped
  try {
    await $.store.delete(STORE_FAILURES)
  } catch (error) {
    skippedRemoved = 0
    notes.push(MESSAGES.resetFailuresKept(messageOf(error)))
  }
  return finishReset($, state, answer, [MESSAGES.resetDone(removed, skippedRemoved), ...notes])
}

// 저장소의 사전에서 그 원문들의 번역문을 빼고 저장합니다. 다른 세션이 저장한 번역을 지우지 않도록 저장하기 직전에 다시 읽습니다.
// 뺄 번역문이 없으면 저장소에 쓰지 않습니다. 저장소에 남은 사전과 뺀 번역문의 수를 돌려줍니다.
async function removeStored(
  $: EngineInterface,
  key: string,
  sources: SourceSet,
): Promise<{ next: Dictionary; removed: number }> {
  const latest = parseDictionary(await $.store.get(key))
  const removed = countStored(latest, sources)
  if (removed === 0) return { next: latest, removed }
  const next = withoutSources(latest, sources)
  await $.store.set(key, next)
  return { next, removed }
}

// 저장소의 실패 기록에서 그 원문들의 횟수를 빼고 저장합니다. 3번 이상 실패해서 건너뛰던 원문 중 뺀 수를 돌려줍니다.
// 버전을 모르면 실패 기록을 쓰지 않으므로 아무것도 하지 않습니다.
async function removeFailures($: EngineInterface, version: string | undefined, sources: SourceSet): Promise<number> {
  if (version === undefined) return 0
  const latest = parseFailures(await $.store.get(STORE_FAILURES), version)
  if (!hasFailures(latest, sources)) return 0
  await $.store.set(STORE_FAILURES, withoutFailures(latest, sources))
  return countSkipped(latest, sources)
}

// 제공자 하나의 원문에 해당하는 자동 번역, 고친 번역, 실패 횟수만 사용자에게 확인을 받은 뒤 지웁니다.
// 이름이 일치하는 제공자가 없으면 아무것도 지우지 않고 지정할 수 있는 이름을 알려 줍니다.
// '지우고 다시 번역'을 고르면 그 제공자의 원문만 다시 번역합니다.
async function resetProvider($: EngineInterface, state: State, argument: string): Promise<string> {
  await collectSources($)
  const loaded = await ensureLoaded($, state)
  await refreshStored($, loaded)
  const provider = matchProvider(state.seen, argument)
  if (provider === undefined) return MESSAGES.resetUnknownProvider(argument, providersOf(state.seen))
  const sources = sourcesOf(state.seen, provider)
  const version = await readVersion($)
  const translations = countStored(loaded.user, sources) + countStored(loaded.overrides, sources)
  const skipped = countSkipped(await readFailures($, version), sources)
  if (translations === 0 && skipped === 0) return MESSAGES.resetProviderNothing(provider)
  const answer = await askReset($, MESSAGES.resetQuestion(translations, skipped, provider))
  if (answer === undefined) return MESSAGES.resetCanceled
  let removed: number
  try {
    const result = await removeStored($, STORE_DICTIONARY, sources)
    retireRemoved(loaded.retired, loaded.user, result.next)
    loaded.user = result.next
    removed = result.removed
  } catch (error) {
    return MESSAGES.resetFailed(messageOf(error))
  }
  const notes: string[] = []
  try {
    const result = await removeStored($, STORE_OVERRIDES, sources)
    retireRemoved(loaded.retired, loaded.overrides, result.next)
    loaded.overrides = result.next
    removed += result.removed
  } catch (error) {
    notes.push(MESSAGES.resetOverridesKept(messageOf(error)))
  }
  let skippedRemoved = 0
  try {
    skippedRemoved = await removeFailures($, version, sources)
  } catch (error) {
    notes.push(MESSAGES.resetFailuresKept(messageOf(error)))
  }
  return finishReset($, state, answer, [MESSAGES.resetDone(removed, skippedRemoved, provider), ...notes], sources)
}
