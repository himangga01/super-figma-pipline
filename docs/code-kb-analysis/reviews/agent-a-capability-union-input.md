# Safe Capability-Union Ledger 초안

> 목적: `figma-mcp-rust` 73개와 Figwright 112개의 lexical union 114개, figmosha2 helper/CLI/raw surface를 빠짐없이 분류해 통합 서비스 구현 계획의 입력으로 사용한다.  
> 기준: Rust `6094566436577b29d04393c774d51492c12671e1`, Figwright `a835e81b575eab2c9265a67f9353c89b848f81ca`, figmosha2 `547cefb4c90abaa1da68db5455b921cbf3f8a5b9`.  
> 원칙: “최대한 사용”은 취약한 server/code를 병렬 유지하는 code union이 아니라, 안전한 canonical contract로 unique semantics를 보존하는 **safe capability union**이다.

## 1. 분류 규칙

### Source

- `R`: `code-kb/figma-mcp-rust/src/tools/definitions.rs`
- `F`: Figwright `code-kb/figwright/packages/mcp/src/tools/*.ts`와 registry
- `M`: figmosha2 helper/CLI/raw surface

### Semantic compatibility

- `same`: 사용자 의도와 핵심 side effect가 같고 Figwright canonical 구현이 Rust 의미를 실질적으로 포함한다.
- `adapter`: 핵심 의도는 같지만 input/result/default, single↔multi, field 이름 등이 달라 compatibility adapter가 필요하다.
- `incompatible`: 같은 이름이지만 format, side effect 또는 보존 의미가 달라 silent alias가 위험하다. 명시적 변환/분리 contract가 필요하다.
- `unique`: 한 source에만 있는 capability다.

### v0.1 disposition

- `native`: Figwright canonical ToolSpec/handler를 보안 hardening 후 유지한다.
- `alias`: 기존 canonical capability의 CLI/SDK convenience alias로 제공한다.
- `adapter`: legacy input/result 또는 unique semantics를 canonical implementation으로 변환하는 adapter를 v0.1에 구현한다.
- `deferred`: registry ledger에는 보존하지만 v0.1 shipping surface에서는 비활성화한다.
- `rejected`: 안전·정책상 제품 surface에서 제거한다.

`native`는 “원본을 무수정 복사”가 아니다. pairing, side-effect metadata, editor capability, per-file queue, runtime result validation, workspace/egress policy를 통과한 구현만 뜻한다.

## 2. Rust 73 + Figwright 112 lexical union 114행

| # | Canonical tool | Source | Compatibility | v0.1 | 이유·adapter 조건 |
|---:|---|---|---|---|---|
| 1 | `ping` | F | unique | native | product/protocol/session/file identity를 검증하는 health authority; `doctor`가 사용 |
| 2 | `get_selection` | R+F | same | native | 현재 selection read 의미 동일; Figwright result를 canonical IR identity로 사용 |
| 3 | `get_document` | R+F | same | native | 현재 document/page tree read; Figwright serializer가 더 충실하나 payload guard 필요 |
| 4 | `get_node` | R+F | same | native | 단일 node read 동일; canonical rich result 사용 |
| 5 | `get_nodes_info` | R+F | same | native | multi-ID read 동일; missing ID를 명시하는 canonical result 유지 |
| 6 | `get_metadata` | R+F | same | native | file/page metadata; editorType/mode/capability를 추가 |
| 7 | `get_pages` | R+F | same | native | page ID/name read 동일 |
| 8 | `search_nodes` | R+F | adapter | adapter | query/root/type/limit와 result shape 차이; Rust legacy fields를 Figwright search로 변환 |
| 9 | `scan_text_nodes` | R+F | adapter | adapter | scope/result 차이; mixed/range typography까지 canonical 확장 |
| 10 | `scan_nodes_by_types` | R+F | adapter | adapter | root/type list/result bbox 차이를 canonical node summary로 변환 |
| 11 | `get_styles` | R+F | same | native | local paint/text/effect/grid style read; Figwright schema authority |
| 12 | `get_variable_defs` | R+F | same | native | collection/mode/value/alias read 동일; file/session provenance 추가 |
| 13 | `get_local_components` | R+F | same | native | local component/set/variant read 동일 |
| 14 | `get_component_api` | F | unique | native | component property/variant authoring용 API metadata |
| 15 | `get_viewport` | R+F | same | native | viewport read 의미 동일 |
| 16 | `get_fonts` | R+F | adapter | adapter | Rust는 mixed TEXT 누락; range-aware canonical font inventory로 통합 |
| 17 | `get_annotations` | R+F | same | native | annotation read 동일; annotation은 untrusted model data로 label |
| 18 | `get_reactions` | R+F | adapter | adapter | raw Reaction shape 차이; plural `actions[]` canonical schema로 normalize |
| 19 | `get_motion_styles` | F | unique | deferred | Motion beta·Figma Design 전용; v0.2 capability gate 후 활성화 |
| 20 | `get_node_motion` | F | unique | deferred | Motion track/preset read; v0.2 live acceptance 필요 |
| 21 | `list_files` | F | unique | native | 실제로는 연결된 열린 host file/session 목록; headless file browser로 표현 금지 |
| 22 | `get_design_context` | R+F | incompatible | adapter | Rust snake/camel bug·부분 serializer와 Figwright full/section contract가 다름; Figwright IR로 고정하고 Rust input만 변환 |
| 23 | `get_screenshot` | R+F | incompatible | adapter | Rust는 PNG/SVG/JPG/PDF base64, Figwright는 vision budget PNG/JPG/SVG blocks; PDF를 별도 canonical export로 분리 |
| 24 | `save_screenshots` | R+F | incompatible | adapter | Rust per-item outputPath와 Figwright nodeIds+outDir가 다름; workspace sandbox 아래 compatibility planner 제공 |
| 25 | `save_image_fills` | F | unique | native | original image-fill bytes의 deterministic asset extraction; output sandbox 필수 |
| 26 | `export_pdf` | F | unique | native | single node/page single-page PDF canonical tool |
| 27 | `export_video` | F | unique | deferred | Motion render·whole-buffer·timeout risk; v0.2 streaming worker 뒤 활성화 |
| 28 | `analyze_project` | F | unique | native | project profile authority; workspace allowlist·truncation metadata 필요 |
| 29 | `scan_components` | F | unique | native | local code AST scanner이며 Figma component discovery가 아님을 contract에 명시 |
| 30 | `component_map` | F | unique | native | Figma component↔code symbol grounding; explicit pinned session/provenance |
| 31 | `token_map` | F | unique | native | variables/styles 두 read를 같은 session에 pin한 뒤 활성화 |
| 32 | `icon_map` | F | unique | native | Figma asset↔repo icon grounding; duplicate ambiguity와 visual hash 보강 |
| 33 | `design_diff` | F | unique | native | file identity namespace·atomic snapshot·schema migration을 먼저 수정 |
| 34 | `set_fills` | R+F | adapter | adapter | Rust hex single paint vs Figwright paint array/gradient/binding; hex legacy input을 canonical paints로 변환 |
| 35 | `set_text` | R+F | same | native | 단일 TEXT characters 변경; mixed font는 range-aware preflight |
| 36 | `set_text_properties` | F | unique | native | node typography property write |
| 37 | `set_text_range` | F | unique | native | rich text range write와 mixed-font 보존 |
| 38 | `create_frame` | R+F | adapter | adapter | Rust inline fill/auto-layout와 Figwright create-then-set 차이; canonical batch plan으로 변환 |
| 39 | `set_opacity` | R+F | adapter | adapter | Rust multi nodeIds vs Figwright single node; bounded fan-out batch |
| 40 | `set_visible` | R+F | adapter | adapter | multi↔single 차이; per-node result와 rollback policy |
| 41 | `rename_node` | R+F | same | native | 단일 node rename 동일; explicit undo boundary |
| 42 | `delete_nodes` | R+F | same | native | multi-delete 동일; destructive approval·precondition 필수 |
| 43 | `create_text` | R+F | adapter | adapter | Rust font/fill/position inline fields를 create+text properties+fills plan으로 변환 |
| 44 | `create_rectangle` | R+F | adapter | adapter | inline fill/radius/parent 차이를 canonical create+set plan으로 변환 |
| 45 | `set_corner_radius` | R+F | adapter | adapter | Rust multi/uniform/per-corner와 Figwright single schema 차이 |
| 46 | `set_strokes` | R+F | adapter | adapter | Rust hex+weight vs Figwright paint array/per-side/dash; legacy hex를 canonical stroke로 변환 |
| 47 | `move_nodes` | R+F | adapter | adapter | Rust multi absolute x/y와 Figwright contract 차이; atomic fan-out |
| 48 | `set_position` | F | unique | native | 단일 node position의 명시적 canonical primitive |
| 49 | `resize_nodes` | R+F | adapter | adapter | multi↔single 및 one-axis default 차이; validated fan-out |
| 50 | `set_auto_layout` | R+F | adapter | adapter | Rust 단일 combined fields와 Figwright layout enable contract 차이 |
| 51 | `set_layout_props` | F | unique | native | sizing/grow/align/wrap/padding 등 세밀한 layout mutation |
| 52 | `set_layout_grids` | F | unique | native | grid rows/columns mutation; editor capability gate |
| 53 | `set_blend_mode` | R+F | adapter | adapter | Rust multi-node enum과 Figwright single-node contract 차이 |
| 54 | `set_mask` | F | unique | native | mask state write; visual post-read 검증 |
| 55 | `set_arc` | F | unique | native | ellipse arc data write |
| 56 | `set_constraints` | R+F | adapter | adapter | Rust multi horizontal/vertical와 Figwright node contract 차이 |
| 57 | `rotate_nodes` | R+F | adapter | adapter | multi↔single absolute rotation; bounded batch |
| 58 | `lock_nodes` | R+F | adapter | adapter | multi↔single lock; approval policy와 editor gate |
| 59 | `unlock_nodes` | R+F | adapter | adapter | multi↔single unlock |
| 60 | `clone_node` | R+F | incompatible | adapter | Rust는 optional reparent/x/y, Figwright는 same-parent adjacent clone; clone 후 set_position/reparent plan으로 legacy 의미 복원 |
| 61 | `set_effects` | R+F | incompatible | adapter | Rust NOISE 포함, Figwright shadow/blur 중심; canonical effect union 확장 전 silent loss 금지 |
| 62 | `create_paint_style` | R+F | adapter | adapter | Rust name+hex vs Figwright paints/result contract; canonical paint schema 사용 |
| 63 | `create_text_style` | R+F | adapter | adapter | field/unit/default와 same-name idempotence 의미 차이 |
| 64 | `create_effect_style` | R+F | adapter | adapter | effect schema/default 차이를 canonical effect item으로 변환 |
| 65 | `create_grid_style` | R+F | adapter | adapter | pattern/count/alignment/color schema 차이 |
| 66 | `update_paint_style` | R+F | adapter | adapter | Rust name/color/description vs Figwright paint object contract 차이 |
| 67 | `update_text_style` | F | unique | native | text style update surface |
| 68 | `update_effect_style` | F | unique | native | effect style update surface |
| 69 | `apply_style_to_node` | R+F | adapter | adapter | Rust optional target vs Figwright required field fill/stroke/effect/grid/text |
| 70 | `delete_style` | R+F | same | native | style ID delete 동일; destructive approval |
| 71 | `create_variable_collection` | R+F | adapter | adapter | initial mode naming/default 차이; plan gate와 mode limit error 보존 |
| 72 | `add_variable_mode` | R+F | same | native | collection+mode name 의미 동일; Figma plan failure 그대로 보고 |
| 73 | `create_variable` | R+F | incompatible | adapter | Rust type+optional first value, Figwright resolvedType+empty variable; create 후 typed set-value plan |
| 74 | `set_variable_value` | R+F | adapter | adapter | Rust string 중심 vs Figwright typed literal/color/alias union; type-aware coercion만 허용 |
| 75 | `bind_variable_to_node` | R+F | adapter | adapter | Rust field vocabulary와 Figwright bindable field schema 차이 |
| 76 | `bind_variable_to_paint` | F | unique | native | fill/stroke paint index binding canonical primitive; figmosha bF/bS backend |
| 77 | `rename_variable` | F | unique | native | variable rename |
| 78 | `set_variable_code_syntax` | F | unique | native | design token↔code ref grounding에 필요한 code syntax write |
| 79 | `delete_variable` | R+F | incompatible | adapter | Rust는 variableId 또는 collectionId overload, Figwright는 variable only; collection은 별도 tool로 route |
| 80 | `delete_variable_collection` | F | unique | native | collection 전체 삭제; destructive approval |
| 81 | `group_nodes` | R+F | adapter | adapter | name/default/result와 node count preflight 차이 |
| 82 | `ungroup_nodes` | R+F | same | native | 의미 동일; Rust same-index order bug는 폐기하고 Figwright inverse/ordered semantics 사용 |
| 83 | `reparent_nodes` | R+F | adapter | adapter | Rust multi vs Figwright canonical per-node/ordering contract 차이 |
| 84 | `reorder_nodes` | R+F | incompatible | adapter | Rust bring/send commands와 Figwright ordering contract를 explicit operation enum으로 변환 |
| 85 | `find_replace_text` | R+F | adapter | adapter | Rust subtree optional/regex flags와 Figwright contract 차이; preview count 필요 |
| 86 | `batch_rename_nodes` | R+F | adapter | adapter | Rust find/regex/prefix/suffix multi schema를 canonical rename plan으로 변환 |
| 87 | `add_page` | R+F | adapter | adapter | index/default/result 차이; document precondition |
| 88 | `delete_page` | R+F | adapter | adapter | Rust ID 또는 name, Figwright canonical identifier 차이; 마지막 page guard |
| 89 | `rename_page` | R+F | adapter | adapter | ID/name selector 차이 |
| 90 | `navigate_to_page` | R+F | adapter | adapter | ID/name selector와 UI-state/editor semantics 차이; document write로 과분류하지 않음 |
| 91 | `set_reactions` | R+F | incompatible | adapter | Rust replace/append+구형 singular 허용, Figwright replace-only plural actions; append는 read/merge/precondition plan |
| 92 | `remove_reactions` | R+F | incompatible | adapter | Rust selective indices 또는 all, Figwright all-clear; selective adapter는 read/filter/set transaction |
| 93 | `swap_component` | R+F | adapter | adapter | Rust local componentId와 Figwright componentId/componentKey import contract 차이 |
| 94 | `set_instance_properties` | F | unique | native | variant/text/boolean/instance-swap property write |
| 95 | `add_component_property` | F | unique | native | component API authoring |
| 96 | `bind_component_property` | F | unique | native | component property↔node field binding |
| 97 | `edit_component_property` | F | unique | native | component property metadata/default update |
| 98 | `delete_component_property` | F | unique | native | destructive component API mutation |
| 99 | `detach_instance` | R+F | adapter | adapter | Rust multi-node vs Figwright canonical single/node result 차이 |
| 100 | `import_image` | R+F | incompatible | adapter | Rust imageData-only decoder vs Figwright data/url+intrinsic size; URL policy와 base64 field adapter 필수 |
| 101 | `import_svg` | F | unique | native | vector import; source sanitization·post-read |
| 102 | `create_ellipse` | R+F | adapter | adapter | inline fill/parent/default size 차이 |
| 103 | `create_component` | R+F | adapter | adapter | Rust FRAME in-place conversion vs Figwright optional fromNodeId/empty component; explicit conversion plan |
| 104 | `create_section` | R+F | adapter | adapter | parent/size/default/result 차이 |
| 105 | `create_instance` | F | unique | native | local componentId 또는 library componentKey instance creation |
| 106 | `combine_as_variants` | F | unique | native | component set/variant authoring |
| 107 | `apply_animation_style` | F | unique | deferred | Motion beta; v0.2 Design-only capability matrix |
| 108 | `remove_animation_style` | F | unique | deferred | destructive Motion mutation; v0.2 |
| 109 | `apply_manual_keyframe_track` | F | unique | deferred | manual Motion track; timeline fixture 필요 |
| 110 | `remove_manual_keyframe_track` | F | unique | deferred | destructive track removal; v0.2 |
| 111 | `set_timeline_duration` | F | unique | deferred | Motion timeline write; v0.2 |
| 112 | `batch` | F | unique | native | inverse allowlist 기반 transaction; in-flight idempotency+preflight+post-verify 후 사용 |
| 113 | `export_tokens` | R | unique | adapter | deterministic JSON/CSS artifact는 token_map과 다른 capability; canonical local export tool로 신설 |
| 114 | `export_frames_to_pdf` | R | unique | adapter | ordered nodeIds→multi-page PDF merge는 Figwright single-page export_pdf와 별도 보존 |

## 3. 114행 집계

아래 수치는 이 표를 parse해 검증한 뒤 확정한다.

| 축 | 분류 | 수 |
|---|---|---:|
| Source | Rust+Figwright | 71 |
| Source | Figwright-only | 41 |
| Source | Rust-only | 2 |
| Compatibility | same | 17 |
| Compatibility | adapter | 43 |
| Compatibility | incompatible | 11 |
| Compatibility | unique | 43 |
| v0.1 | native | 50 |
| v0.1 | adapter | 56 |
| v0.1 | deferred | 8 |
| v0.1 | alias | 0 |
| v0.1 | rejected | 0 |

## 4. figmosha2 helper 20 mapping

| # | figmosha helper | Canonical mapping | Compatibility | v0.1 | 비고 |
|---:|---|---|---|---|---|
| 1 | `bF` | `bind_variable_to_paint(field=fill)` | adapter | alias | frozen paint handling은 canonical handler가 담당 |
| 2 | `bS` | `bind_variable_to_paint(field=stroke)` | adapter | alias | stroke paint index binding |
| 3 | `bN` | `bind_variable_to_node` | adapter | alias | bindable field/type preflight 추가 |
| 4 | `findByName` | `search_nodes` exact-name preset | adapter | alias | first-result convenience |
| 5 | `findAllByName` | `search_nodes` exact-name preset | adapter | alias | pagination/limit 표면화 |
| 6 | `dumpTree` | `get_design_context(compact/full)` | adapter | alias | 문자열 dump보다 structured result 유지 |
| 7 | `withFonts` | range-aware typography preflight | adapter | native | mixed font를 skip하지 않고 range font load plan |
| 8 | `setText` | `set_text` / `set_text_range` | adapter | alias | single vs mixed 자동 route |
| 9 | `cloneNext` | `clone_node` + `set_position` | adapter | alias | direction/gap convenience, auto-layout parent 경고 |
| 10 | `variant` | `set_instance_properties` | adapter | alias | property schema/allowed values preflight |
| 11 | `variantsOf` | `get_component_api` | adapter | alias | current/groups/all view |
| 12 | `sel` | `get_selection` | same | alias | natural-language target resolver와 결합 |
| 13 | `hex` | client paint utility | same | alias | `#RGB/#RRGGBB`→canonical RGBA, alpha 지원 보강 |
| 14 | `solid` | canonical paint builder | adapter | alias | set_fills/create style input 생성 utility |
| 15 | `frame` | `batch(create_frame,set_auto_layout,set_fills)` | adapter | alias | append→layout→size→sizing→spacing 순서 보존 |
| 16 | `resolve` | target resolver | adapter | native | `page`/`sel`/node URL/ID, explicit session/file 포함 |
| 17 | `node` | `get_node` | same | alias | null을 structured not-found로 변환 |
| 18 | `var_` | variable resolver + library import | unique | adapter | local ID lookup 뒤 **typed library variable import** fallback 신설 |
| 19 | `importComp` | `create_instance(componentKey)` 또는 `swap_component(componentKey)` | same | alias | Figwright가 이미 library component key import 지원 |
| 20 | `importVar` | `import_library_variable` 신설 | unique | adapter | 현재 Figwright registry에 없는 고유 capability; permission/policy test 필요 |

## 5. figmosha2 CLI parser 12 / 고유 동작 11 mapping

| # | Parser name | 고유 동작 | Canonical mapping | v0.1 | 비고 |
|---:|---|---|---|---|---|
| 1 | `status` | status | `ping` summary | alias | product/protocol/session/file identity 엄격 검증 |
| 2 | `doctor` | doctor | `doctor` orchestration 신설 | native | server→pairing→plugin→editor→permission→workspace→round-trip 단계 진단 |
| 3 | `sel` | selection | `get_selection` | alias | target resolver 출력 |
| 4 | `exec` | arbitrary script | expert execution capability | rejected | public/release build에서는 compile-time 제거 |
| 5 | `tree` | tree dump | `get_design_context` | alias | detail/depth/section plan을 보존 |
| 6 | `find` | filtered search | `search_nodes` | alias | exact/substring/type/text preset |
| 7 | `text` | text mutation | `set_text`/`set_text_range` | alias | mixed range 지원 |
| 8 | `variant` | instance props | `set_instance_properties` | alias | canonical schema 사용 |
| 9 | `clone` | adjacent clone | `clone_node`+`set_position` | alias | direction/gap flags |
| 10 | `rm` | delete | `delete_nodes` | alias | destructive approval 필수 |
| 11 | `import-component` | library instance | `create_instance(componentKey)` | alias | Figwright native 기능 재사용 |
| 12 | `icomp` | import-component alias | 위와 동일 | alias | parser alias라 고유 동작 수에는 추가하지 않음 |

### Raw exec의 이중 disposition

| 배포 surface | 결정 | 조건 |
|---|---|---|
| Public/Community/normal v0.1 | **rejected** | raw `new Function` code execution을 build에서 제거 |
| Local expert development build | **deferred** | compile-time feature, session별 explicit enable, source audit, mutation 1회 승인, no network/fs capability |

즉 raw exec의 기능적 escape hatch는 ledger에서 잃지 않지만, public v0.1 surface에는 포함하지 않는다.

## 6. 빠진 고유 capability와 v0.1 action

| Capability | Source | v0.1 action | Acceptance |
|---|---|---|---|
| `doctor` | M | native 신설 | wrong product/port/version, no plugin, Dev read-only, workspace denial을 각각 진단 |
| deterministic `export_tokens` | R | adapter 신설 | JSON/CSS golden output, modes/aliases collision test |
| ordered multi-page PDF | R | `export_frames_to_pdf` adapter 신설 | ordered page count, mixed size, corrupt page, no-overwrite/output sandbox fixture |
| library variable import | M | `import_library_variable` typed tool 신설 | local ID, valid key, permission denial, missing key, bind round-trip |
| expert exec | M | public rejected, expert deferred | release bundle symbol absence; dev build approval/audit negative tests |

## 7. 구현 hard gate

1. 114 tool row의 `implementationStatus`가 `unclassified` 0이어야 한다.
2. Rust/Figwright 동일 이름 71개는 schema/result adapter golden test 없이는 “compatible” badge를 받지 않는다.
3. Figwright native 112개를 fork에서 accidental drop하지 않는다. v0.1 deferred 8개는 capability response에 이유를 표시한다.
4. `token_map` session pin과 `design_diff` file identity를 먼저 수정한다.
5. destructive/filesystem/network/editor/model-egress metadata를 canonical registry에 둔다.
6. Public artifact에 raw exec code path가 존재하지 않음을 bundle scan으로 증명한다.
7. `LICENSES`, `THIRD_PARTY_NOTICES`, SBOM이 npm/plugin artifact에 포함돼야 한다.

## 8. 결론

v0.1은 Figwright canonical implementation을 중심으로 기존 112개 중 비-Motion 104개를 보존하고, Rust unique 2개를 adapter로 추가하며, figmosha helper/CLI는 중복 backend가 아닌 aliases·utility·doctor로 흡수한다. Motion 7개와 video 1개는 ledger에 남기되 v0.2로 deferred한다. Public raw exec는 rejected, audited expert exec는 deferred다.

이 ledger는 구현 계획 입력 초안이다. 실제 source-of-truth는 product repository의 generated registry로 옮기고, 각 행에 schema hash·test·implementation commit을 연결해야 한다.
