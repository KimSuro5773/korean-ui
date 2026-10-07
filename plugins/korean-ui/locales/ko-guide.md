# korean-ui 번역 지침

이 문서는 Claude Code의 명령어 설명과 /config 설정 항목을 한국어로 번역할 때 따르는 지침입니다. Haiku에게 보내는 번역 지시문이면서, 기본 번역표를 검수하는 기준입니다.

## 원문 충실성

- 원문에 없는 설명이나 단어를 덧붙이지 않습니다.
- 원문에 있는 정보를 빼지 않습니다.
- 원문의 의미와 순서를 최대한 유지하고, 다른 표현으로 크게 바꾸어 쓰지 않습니다.
- 원문의 문장부호 구조를 유지합니다. 괄호는 그대로 두고, 세미콜론으로 이어진 부분은 문장을 나누어 옮깁니다.
- 원문보다 길게 늘이지 않습니다.

## 문체

- 명령어와 스킬의 설명은 문장형(~합니다)으로 번역합니다.
- /config 항목 이름은 원문의 형태를 따릅니다. 원문이 명사이면 명사로 번역합니다.
- 번역문은 한 줄로 씁니다. 줄바꿈을 넣지 않습니다.
- 영어의 and/or는 "및/또는"으로 옮기지 않고, "A, B 또는 둘 다"처럼 자연스러운 한국어로 옮깁니다.

## 그대로 둘 것

- 명령어 이름(/resume 등), 옵션(--flag 등), 파일 이름과 경로, 코드 식별자, 백틱(`)으로 감싼 코드
- 제품과 서비스 이름: Claude Code, Claude, MCP, GitHub, IDE 이름 등

## 용어집

같은 용어는 항상 같은 말로 번역합니다.

| 영어 | 한국어 |
|---|---|
| session | 세션 |
| context | 컨텍스트 |
| plugin | 플러그인 |
| skill | 스킬 |
| permission | 권한 |
| model | 모델 |
| subagent | 서브에이전트 |
| directory | 디렉터리 |
| repository | 저장소 |
| artifact | 아티팩트 |
| workflow | 워크플로우 |
| worktree | 워크트리 |
| status line | 상태 줄 |
| plan mode | 플랜 모드 |
| plan (요금제) | 요금제 |
| limit | 한도 |
| access | 접근 권한 |
| harness | 하네스 |
| changes | 변경 사항 |
| thinking mode | 사고 모드 |
| verbose | 상세 |
| effort | effort (그대로 둡니다) |

## 예시

- 원문: Start a new session with empty context; previous session stays on disk (resumable with /resume)
- 번역: 빈 컨텍스트로 새 세션을 시작합니다. 이전 세션은 디스크에 유지됩니다(/resume으로 이어서 진행할 수 있습니다)
- 원문: Restore the code and/or conversation to a previous point
- 번역: 코드, 대화 또는 둘 다를 이전 시점으로 복원합니다
