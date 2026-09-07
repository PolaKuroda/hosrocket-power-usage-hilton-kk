# 08 — New Feature Playbook

A file-by-file recipe for adding a feature to `admin.hosrocket.com` that looks and behaves like
the rest of the product. Copy the templates; change the names.

Worked example throughout: a site-scoped, paginated, CRUD-able resource called **`shift_note`**
(a note left by one shift for the next). It exercises every layer.

---

## 0. Decide the shape first

| Question | If yes → |
|---|---|
| Does it need new persisted data? | A **core API** change + SDK/type release. Say so up front — cross-repo, longer lead time. See [06 §8](06-core-api-architecture.md#8-checklist-adding-a-new-entity-to-core) |
| Is it site-scoped? | Lives under `views/pages/site/site_detail/`, gets a sidebar entry under an existing section, needs `site_id` on every call |
| Is it a paginated list? | Archetype A + a `createTableStore` |
| Is it a gallery of things with photos? | Archetype B (card grid) |
| Does it touch hardware/RCU? | Read [07 §4](07-edge-and-worker-processes.md#4-designing-a-feature-that-touches-this-path) first |
| Is it real-time? | Needs a worker → socket.io → client path |
| Must it work on-prem? | No GCS, no Pub/Sub, no cache invalidator |

Then pick **one of the four UI archetypes** from
[03 §4](03-admin-ui-design-system.md#4-page-patterns). Do not invent a fifth.

---

## 1. Files you will touch

### Shared (`src/shared`)
```
enum/role_permission.ts                    ← add View/Create/Update/Delete ShiftNote
enum/shift_note_status.ts                  ← new enum, if the feature has statuses
type/shift_note.ts                         ← HydratedShiftNote
```

### Server / BFF (`src/server`)
```
app/api_model/shift_note.ts                ← Core SDK wrappers
app/controller/api/shift_note.ts           ← permission checks + hydration
app/setup/router/api/shift_note.ts         ← route definitions
app/setup/router/api.ts                    ← register: router.use('/shift-notes', requireLogin, shiftNoteRouter())
```

### Client (`src/client`)
```
state/action_type/shift_note.ts            ← action-type enum
state/action/shift_note.ts                 ← thunks
state/reducer/reducers/shift_note.ts       ← modal/UI state
state/reducer/index.ts                     ← register reducer + shiftNoteTableStore
views/pages/site/site_detail/ShiftNote.tsx ← the page
views/pages/site/site_detail/shift_note/AddShiftNoteModal.tsx
views/pages/site/site_detail/shift_note/EditShiftNoteModal.tsx
views/pages/site/SiteDetail.tsx            ← add <Route path="shift-note" …>
views/layout/portal/SidebarContent.tsx     ← add the permission-gated nav link
locale/en.json (+ ja, zh-HK, zh-CN, th, vi, ms, id)
styles/page/site_detail/shiftNote.scss     ← only if Bootstrap utilities aren't enough
```

---

## 2. Shared enums & types

```ts
// src/shared/enum/role_permission.ts  (add to the existing enum)
ViewShiftNote   = 'view-shift-note',
CreateShiftNote = 'create-shift-note',
UpdateShiftNote = 'update-shift-note',
DeleteShiftNote = 'delete-shift-note',
```

```ts
// src/shared/type/shift_note.ts
import {APITypes} from '@bossagroove/core.hosrocketapi.com_type';

export type HydratedShiftNote = APITypes.Model.ShiftNote & {
    user?: APITypes.Model.User;
    room?: APITypes.Model.Room;
};
```

> `Hydrated*` = the raw core model plus the related entities the BFF joins in for the UI.
> Keep the joined fields **optional** — the BFF may fail to resolve them.

---

## 3. BFF — `api_model`

```ts
// src/server/app/api_model/shift_note.ts
import SharedManager from '@lib/shared_manager';
import {APITypes} from '@bossagroove/core.hosrocketapi.com_sdk';
import config from '@config';

export async function getShiftNotesBySiteId({site_id, page}: {
    site_id: string;
    page?: string;
}): Promise<{
    shift_notes: APITypes.Model.ShiftNote[];
    pagination: APITypes.Common.Pagination;
}> {
    const coreSdk = SharedManager.getSdk();

    try {
        return await coreSdk.shiftNote.getShiftNotes({
            params: {
                site_id,
                page: page ? parseInt(page, 10) : 1,
                limit: config.pagination.default_limit
            }
        });
    } catch (e) {
        return {
            shift_notes: [],
            pagination: {count: 0, page: 0, page_count: 0, limit: 0}
        };
    }
}

export async function createShiftNote(
    data: APITypes.Request.PostShiftNotesBody,
    user_id: string
): Promise<APITypes.Model.ShiftNote | null> {
    const coreSdk = SharedManager.getSdk();

    try {
        return await coreSdk.shiftNote.createShiftNote({
            data,
            headers: {'on-behalf-of-user-id': user_id}
        });
    } catch (e) {
        return null;
    }
}
```

Rules: swallow errors → `null` / empty; always pass `on-behalf-of-user-id` on mutations; do
cross-entity joins here.

---

## 4. BFF — controller

```ts
// src/server/app/controller/api/shift_note.ts
import {Request, Response} from 'express';
import _ from 'lodash';

import {ErrorCode} from '@enum/error_code';
import RolePermission from '@enum/role_permission';
import ResponseManager from '@lib/response_manager';
import * as APIShiftNote from '@api_model/shift_note';
import * as APISite from '@api_model/site';
import * as APIUser from '@api_model/user';
import {HydratedShiftNote} from '@shared_type/shift_note';

export async function getShiftNotes(req: Request<{}, {}, {}, {
    site_id: string;
    page?: string;
}>, res: Response) {
    const {site_id, page} = req.query;

    const rolePermissions = await APISite.getRolePermissions(site_id, req.user.id);
    if (!rolePermissions.includes(RolePermission.ViewSite) ||
        !rolePermissions.includes(RolePermission.ViewShiftNote)) {
        ResponseManager.output({res, error: ErrorCode.Forbidden});
        return;
    }

    const site = await APISite.findById(site_id);
    if (!site) {
        ResponseManager.output({
            res, error: ErrorCode.BadRequest, errorMessage: 'site_not_found'
        });
        return;
    }

    const {shift_notes, pagination} = await APIShiftNote.getShiftNotesBySiteId({site_id, page});

    const hydrated: HydratedShiftNote[] = _.cloneDeep(shift_notes);
    // … join users/rooms here …

    ResponseManager.output({
        res,
        error: ErrorCode.Ok,
        data: {
            page:        pagination.page,
            count:       pagination.count,
            page_count:  pagination.page_count,
            shift_notes: hydrated
        }
    });
}

export async function createShiftNote(req: Request<{}, {}, {
    site_id: string;
    body: string;
}>, res: Response) {
    const {site_id, body} = req.body;

    if (!site_id || !body) {
        ResponseManager.output({
            res, error: ErrorCode.BadRequest, errorMessage: 'site_id_and_body_are_required'
        });
        return;
    }

    const rolePermissions = await APISite.getRolePermissions(site_id, req.user.id);
    if (!rolePermissions.includes(RolePermission.CreateShiftNote)) {
        ResponseManager.output({res, error: ErrorCode.Forbidden});
        return;
    }

    const shiftNote = await APIShiftNote.createShiftNote({site_id, body}, req.user.id);
    if (!shiftNote) {
        ResponseManager.output({
            res, error: ErrorCode.BadRequest, errorMessage: 'unable_to_create_shift_note'
        });
        return;
    }

    ResponseManager.output({res, error: ErrorCode.Ok, data: shiftNote});
}
```

**Non-negotiables**
- Permission check first, then existence checks, then work.
- Early `return` after every `ResponseManager.output(...)`.
- `errorMessage` values are snake_case codes the client can switch on.
- List responses use the flat `{page, count, page_count, <resource>s}` shape.

---

## 5. BFF — router + registration

```ts
// src/server/app/setup/router/api/shift_note.ts
import {Router} from 'express';
import asyncHandler from 'express-async-handler';
import {getShiftNotes, createShiftNote, updateShiftNote, deleteShiftNote}
    from '@controller/api/shift_note';

function shiftNoteRouter(): Router {
    const router = Router({mergeParams: true});

    router.get('/',                  asyncHandler(getShiftNotes));
    router.post('/',                 asyncHandler(createShiftNote));
    router.patch('/:shift_note_id',  asyncHandler(updateShiftNote));
    router.delete('/:shift_note_id', asyncHandler(deleteShiftNote));

    return router;
}

export default shiftNoteRouter;
```

```ts
// src/server/app/setup/router/api.ts
import shiftNoteRouter from './api/shift_note';
…
router.use('/shift-notes', requireLogin, shiftNoteRouter());
```

---

## 6. Client — action types

```ts
// src/client/state/action_type/shift_note.ts
enum ShiftNoteActionType {
    SHIFT_NOTE_LIST_REQUEST = 'SHIFT_NOTE_LIST_REQUEST',
    SHIFT_NOTE_LIST_SUCCESS = 'SHIFT_NOTE_LIST_SUCCESS',
    SHIFT_NOTE_LIST_FAIL    = 'SHIFT_NOTE_LIST_FAIL',
    SHIFT_NOTE_LIST_DISMISS = 'SHIFT_NOTE_LIST_DISMISS',

    SHIFT_NOTE_SHOW_ADD_MODAL = 'SHIFT_NOTE_SHOW_ADD_MODAL',
    SHIFT_NOTE_HIDE_ADD_MODAL = 'SHIFT_NOTE_HIDE_ADD_MODAL',
    SHIFT_NOTE_ADD_REQUEST    = 'SHIFT_NOTE_ADD_REQUEST',
    SHIFT_NOTE_ADD_SUCCESS    = 'SHIFT_NOTE_ADD_SUCCESS',
    SHIFT_NOTE_ADD_FAIL       = 'SHIFT_NOTE_ADD_FAIL'
}

export default ShiftNoteActionType;
```

---

## 7. Client — thunks

```ts
// src/client/state/action/shift_note.ts
import {AxiosError} from 'axios';
import {Action} from '@reduxjs/toolkit';

import ShiftNoteActionType from '@action_type/shift_note';
import {callApi} from '@lib/api';
import {toaster} from '@lib/toaster';
import i18n from '@lib/i18n';
import {AppThunkAsync} from '@root/setup/store';

function getApiErrorMessage(error: unknown): string | null {
    if (!(error instanceof AxiosError)) return null;
    return error.response?.data?.meta?.message || null;
}

export const shiftNoteListRequest = ({site_id, page}: {
    site_id: string;
    page: number;
}): AppThunkAsync => {
    return async (dispatch) => {
        dispatch({type: ShiftNoteActionType.SHIFT_NOTE_LIST_REQUEST, payload: {page}});

        let response;
        try {
            response = await callApi({
                method: 'GET',
                path: '/api/shift-notes',
                params: {site_id, page},
                dispatch
            });
        } catch (e) {
            dispatch({type: ShiftNoteActionType.SHIFT_NOTE_LIST_FAIL});
            return;
        }

        dispatch({
            type: ShiftNoteActionType.SHIFT_NOTE_LIST_SUCCESS,
            payload: {
                data_rows:  response.data.shift_notes,
                page:       response.data.page,
                count:      response.data.count,
                page_count: response.data.page_count
            }
        });
    };
};

export const shiftNoteListDismiss = (): Action => {
    return {type: ShiftNoteActionType.SHIFT_NOTE_LIST_DISMISS};
};

export const showAddShiftNoteModal = (): Action<ShiftNoteActionType> => {
    return {type: ShiftNoteActionType.SHIFT_NOTE_SHOW_ADD_MODAL};
};

export const hideAddShiftNoteModal = (): Action<ShiftNoteActionType> => {
    return {type: ShiftNoteActionType.SHIFT_NOTE_HIDE_ADD_MODAL};
};

export const addShiftNoteRequest = ({site_id, body}: {
    site_id: string;
    body: string;
}): AppThunkAsync => {
    return async (dispatch, getState) => {
        dispatch({type: ShiftNoteActionType.SHIFT_NOTE_ADD_REQUEST});

        try {
            await callApi({
                method: 'POST',
                path: '/api/shift-notes',
                data: {site_id, body},
                dispatch,
                noBusy: true
            });

            dispatch({type: ShiftNoteActionType.SHIFT_NOTE_ADD_SUCCESS});

            // refresh the list on the page the user is currently on
            const state = getState();
            dispatch(shiftNoteListRequest({
                site_id,
                page: state.shiftNoteTableStore.page || 1
            }));

            toaster.success(i18n.t('shift_note.msg_shift_note_created'));
        } catch (error) {
            dispatch({
                type: ShiftNoteActionType.SHIFT_NOTE_ADD_FAIL,
                payload: {errorCode: getApiErrorMessage(error) || 'request_failed'}
            });
        }
    };
};
```

Note `noBusy: true` on modal submits: the modal manages its own busy state via `Stage`, so the
whole page shouldn't freeze.

---

## 8. Client — reducer + registration

```ts
// src/client/state/reducer/reducers/shift_note.ts
import {PayloadAction} from '@reduxjs/toolkit';
import ShiftNoteActionType from '@state/action_type/shift_note';
import Stage from '@state/enum/stage';

interface ShiftNoteState {
    showAddShiftNoteModal: boolean;
    addShiftNoteStage: Stage;
    addShiftNoteErrorCode: string | null;
}

export default function shiftNote(state: ShiftNoteState = {
    showAddShiftNoteModal: false,
    addShiftNoteStage: Stage.NOT_START,
    addShiftNoteErrorCode: null
}, action: PayloadAction<any, ShiftNoteActionType>): ShiftNoteState {
    switch (action.type) {
        case ShiftNoteActionType.SHIFT_NOTE_SHOW_ADD_MODAL:
            return Object.assign({}, state, {
                showAddShiftNoteModal: true,
                addShiftNoteStage: Stage.NOT_START,
                addShiftNoteErrorCode: null
            });
        case ShiftNoteActionType.SHIFT_NOTE_HIDE_ADD_MODAL:
            return Object.assign({}, state, {showAddShiftNoteModal: false});
        case ShiftNoteActionType.SHIFT_NOTE_ADD_REQUEST:
            return Object.assign({}, state, {
                addShiftNoteStage: Stage.PENDING,
                addShiftNoteErrorCode: null
            });
        case ShiftNoteActionType.SHIFT_NOTE_ADD_SUCCESS:
            return Object.assign({}, state, {
                addShiftNoteStage: Stage.SUCCESS,
                showAddShiftNoteModal: false
            });
        case ShiftNoteActionType.SHIFT_NOTE_ADD_FAIL:
            return Object.assign({}, state, {
                addShiftNoteStage: Stage.FAIL,
                addShiftNoteErrorCode: action.payload.errorCode
            });
        default:
            return state;
    }
}
```

```ts
// src/client/state/reducer/index.ts
import shiftNote from './reducers/shift_note';
import ShiftNoteActionType from '@action_type/shift_note';
import * as ShiftNoteType from '@shared_type/shift_note';

export default (routerReducer: Reducer) => combineReducers({
    …
    shiftNote,
    shiftNoteTableStore: createTableStore<ShiftNoteType.HydratedShiftNote>({
        requestStateKey: ShiftNoteActionType.SHIFT_NOTE_LIST_REQUEST,
        successStateKey: ShiftNoteActionType.SHIFT_NOTE_LIST_SUCCESS,
        failStateKey:    ShiftNoteActionType.SHIFT_NOTE_LIST_FAIL,
        dismissKey:      ShiftNoteActionType.SHIFT_NOTE_LIST_DISMISS
    })
});
```

**Never hand-write list state.** Use `createTableStore`.

---

## 9. Client — the page

```tsx
// src/client/views/pages/site/site_detail/ShiftNote.tsx
import React, {ReactNode, useEffect} from 'react';
import {useNavigate, useLocation, NavigateFunction} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {Row, Col, Table, Button} from 'react-bootstrap';
import FadeIn from 'react-fade-in';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPlus} from '@fortawesome/free-solid-svg-icons/faPlus';

import PageBox, {GoToPageCallback} from '@views/components/PageBox';
import TablePlaceholder from '@views/components/TablePlaceholder';
import Stage from '@state/enum/stage';
import RolePermission from '@enum/role_permission';
import {useAppDispatch, useAppSelector} from '@root/setup/hook';
import {shiftNoteListRequest, shiftNoteListDismiss, showAddShiftNoteModal}
    from '@action/shift_note';
import * as PortalStyle from '@styles/common/portal.scss';

import AddShiftNoteModal from './shift_note/AddShiftNoteModal';

function goToPageCallback(navigate: NavigateFunction, organizationSlug: string, siteSlug: string): GoToPageCallback {
    return (toPage: number) => {
        navigate(`/organizations/${organizationSlug}/sites/${siteSlug}/shift-note?page=${toPage}`);
    };
}

function useQuery() {
    return new URLSearchParams(useLocation().search);
}

const ShiftNote = () => {
    const {t} = useTranslation();
    const dispatch = useAppDispatch();
    const navigate = useNavigate();

    const query = useQuery();
    let page = parseInt(String(query.get('page')), 10);
    if (isNaN(page)) {
        page = 1;
    }

    const {organization, site, siteRolePermissions} = useAppSelector(store => store.userInfo);
    const uiBusy = useAppSelector(store => store.uiBusy);
    const shiftNoteTableStore = useAppSelector(store => store.shiftNoteTableStore);

    useEffect(() => {
        if (site) {
            dispatch(shiftNoteListRequest({site_id: site.id, page}));
        }
    }, [page]);

    useEffect(() => {
        return function cleanup() {
            dispatch(shiftNoteListDismiss());
        };
    }, []);

    const canUpdate = siteRolePermissions.includes(RolePermission.UpdateShiftNote);
    const columnCount = canUpdate ? 4 : 3;

    const rows: ReactNode[] = [];
    for (const shiftNote of shiftNoteTableStore.data_rows) {
        rows.push(
            <tr key={shiftNote.id}>
                <td>{shiftNote.created_at}</td>
                <td>{shiftNote.user?.name}</td>
                <td>{shiftNote.body}</td>
                {canUpdate ? (
                    <td>
                        <Button disabled={uiBusy} onClick={() => {/* … */}}>
                            {t('shift_note.label_edit')}
                        </Button>
                    </td>
                ) : null}
            </tr>
        );
    }

    return (
        <FadeIn>
            <AddShiftNoteModal />
            <Row>
                <Col>
                    <Row className="pt-3 pb-2 mb-4 border-bottom">
                        <Col xs={6}>
                            <h1 className={PortalStyle.pageTitle}>
                                {t('shift_note.shift_note')}
                            </h1>
                        </Col>
                        <Col xs={6} className="text-end">
                            {siteRolePermissions.includes(RolePermission.CreateShiftNote) ? (
                                <Button disabled={uiBusy} onClick={() => {dispatch(showAddShiftNoteModal())}}>
                                    <FontAwesomeIcon icon={faPlus} className="me-2" />
                                    {t('shift_note.add_new_shift_note')}
                                </Button>
                            ) : ''}
                        </Col>
                    </Row>

                    <Row className="position-relative">
                        <Col>
                            <Row>
                                <Col>
                                    <Table responsive>
                                        <thead>
                                            <tr>
                                                <th>{t('common_label.created_at')}</th>
                                                <th>{t('shift_note.author')}</th>
                                                <th>{t('shift_note.body')}</th>
                                                {canUpdate ? <th>{t('common.action')}</th> : null}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <TablePlaceholder
                                                columns={canUpdate
                                                    ? [{type: 'text'}, {type: 'text'}, {type: 'text'}, {type: 'button'}]
                                                    : [{type: 'text'}, {type: 'text'}, {type: 'text'}]}
                                                show={!shiftNoteTableStore.initialized} />
                                            {rows}
                                            {shiftNoteTableStore.data_stage === Stage.SUCCESS && rows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={columnCount} className="text-center py-5">
                                                        {t('shift_note.no_shift_note')}
                                                    </td>
                                                </tr>
                                            ) : null}
                                        </tbody>
                                    </Table>
                                </Col>
                            </Row>
                            <Row>
                                <Col>
                                    <PageBox
                                        page={page}
                                        count={shiftNoteTableStore.count}
                                        pageCount={shiftNoteTableStore.page_count}
                                        goToPageCallback={goToPageCallback(navigate, organization?.slug || '', site?.slug || '')} />
                                </Col>
                            </Row>
                        </Col>
                    </Row>
                </Col>
            </Row>
        </FadeIn>
    );
};

export default ShiftNote;
```

---

## 10. Client — the modal

Follow [03 §4.3](03-admin-ui-design-system.md#43-archetype-c--modal-form-create--edit--detail)
exactly. Skeleton:

```tsx
const AddShiftNoteModal = () => {
    const {t} = useTranslation();
    const dispatch = useAppDispatch();
    const {register, handleSubmit, formState: {errors}, reset, clearErrors} = useForm<FormValues>();
    const {site} = useAppSelector(store => store.userInfo);
    const shiftNote = useAppSelector(store => store.shiftNote);

    const {showAddShiftNoteModal} = shiftNote;
    const formBusy = shiftNote.addShiftNoteStage === Stage.PENDING;
    const submitMessage = getSubmitMessage(t, shiftNote.addShiftNoteErrorCode);

    useEffect(() => {
        reset({body: ''});
        clearErrors();
    }, [showAddShiftNoteModal]);

    return (
        <Modal backdrop="static" size="lg" show={showAddShiftNoteModal} centered={true}
               onHide={() => dispatch(hideAddShiftNoteModal())}>
            <Modal.Header closeButton>
                <Modal.Title>{t('shift_note.add_new_shift_note')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Form onSubmit={handleSubmit((data) => {
                    dispatch(addShiftNoteRequest({site_id: site?.id || '', body: data.body.trim()}));
                })} noValidate>

                    {submitMessage ? (
                        <Alert variant="warning" className="mb-3">{submitMessage}</Alert>
                    ) : null}

                    <Form.Group as={Row} className="mb-3" controlId="shift-note-body">
                        <Form.Label column sm={3}>{t('shift_note.body')}</Form.Label>
                        <Col sm={9}>
                            <Form.Control as="textarea" rows={4} disabled={formBusy}
                                          {...register('body', {required: true})}
                                          isInvalid={Boolean(errors.body)} />
                            <Form.Control.Feedback type="invalid" className="text-start">
                                {t('shift_note.validation.body_required')}
                            </Form.Control.Feedback>
                        </Col>
                    </Form.Group>

                    <Modal.Footer className="px-0 pb-0">
                        <Button variant="secondary" disabled={formBusy}
                                onClick={() => dispatch(hideAddShiftNoteModal())}>
                            {t('shift_note.btn_cancel')}
                        </Button>
                        <Button type="submit" disabled={formBusy || !site?.id}>
                            {formBusy ? <FontAwesomeIcon icon={faSpinner} spinPulse /> : null}
                            <span className={formBusy ? 'ms-2' : ''}>{t('shift_note.btn_save')}</span>
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal.Body>
        </Modal>
    );
};
```

And the error-code mapper that lives at the top of the same file:

```ts
function getSubmitMessage(t: ReturnType<typeof useTranslation>['t'], errorCode: string | null): string | null {
    if (!errorCode) return null;
    switch (errorCode) {
        case 'body_required':
            return null;                                   // shown as a field error instead
        case 'unable_to_create_shift_note':
            return t('shift_note.msg_unable_to_create');
        default:
            return t('shift_note.msg_request_failed');
    }
}
```

---

## 11. Wire the route and the sidebar

```tsx
// src/client/views/pages/site/SiteDetail.tsx
import ShiftNote from './site_detail/ShiftNote';
…
<Route path="shift-note" element={<ShiftNote />} />
```

```tsx
// src/client/views/layout/portal/SidebarContent.tsx — inside case Page.Site,
// under an existing section header (e.g. "service order")
{siteRolePermissions?.includes(RolePermission.ViewShiftNote) ? (
    <Nav.Link
        className={pageInfo.subpage === 'shift-note' ? 'current-page' : ''}
        as={Link}
        to={`/organizations/${organization.slug}/sites/${site.slug}/shift-note`}
        onClick={() => dispatch(hideMobileSidebar())}>
        {t('shift_note.shift_note')}
    </Nav.Link>
) : ''}
```

Existing sidebar sections: **Management · Service order · Alerts · Notification ·
Luggage management · Settings**. Put the item in the right one rather than adding a section.

---

## 12. Translations

Add a `shift_note` namespace to **all eight** locale files:

```json
"shift_note": {
    "shift_note": "Shift Note",
    "add_new_shift_note": "Add New Shift Note",
    "author": "Author",
    "body": "Note",
    "no_shift_note": "No shift note",
    "label_edit": "Edit",
    "btn_cancel": "Cancel",
    "btn_save": "Save",
    "msg_shift_note_created": "Shift note created",
    "msg_unable_to_create": "Unable to create shift note",
    "msg_request_failed": "Request failed, please try again",
    "validation": {
        "body_required": "Note is required"
    }
}
```

Reuse `common` / `common_label` for generic words (`action`, `created_at`, `room`, `floor`,
`device`, `start_at`, `end_at`, …) instead of duplicating them.

---

## 13. Run it

```bash
# terminal 1 — BFF (cloud env)
cd reference/admin.hosrocket.com/src/server && yarn dev        # :4001

# terminal 2 — SPA dev server (proxies to :4001)
cd reference/admin.hosrocket.com/src/client && yarn dev        # :4000
```

On-prem mode: `yarn dev-op` for the server.
Type-check before pushing (`esbuild-loader` does **not** type-check):
`cd src/server && yarn build:dev`, and rely on your editor for the client.

---

## 14. Definition of done

**Design / UI** — see the full checklist in
[03 §10](03-admin-ui-design-system.md#10-design-checklist-for-a-new-screen).

**Code**
- [ ] No new dependency that duplicates something in [02](02-tech-stack.md)
- [ ] Client: action_type enum + thunks + switch reducer + `createTableStore`
      (no `createSlice`, no `useState` for server data or filters)
- [ ] All HTTP through `callApi()`; success toasts fired from thunks
- [ ] `*Dismiss` dispatched in the page's unmount cleanup
- [ ] Filters and page number live in the query string
- [ ] BFF: router → controller → `api_model` → Core SDK; nothing skips a layer
- [ ] Permission checked **server-side** in every controller, not just in the UI
- [ ] `on-behalf-of-user-id` passed on every mutation
- [ ] Responses use `ResponseManager` and the `{meta, data}` envelope; lists are
      `{page, count, page_count, <resource>s}`
- [ ] Error messages are snake_case codes mapped to translated strings on the client
- [ ] Shared enums/types in `src/shared`, not duplicated on one side
- [ ] Path aliases used, no `../../../..`
- [ ] Tabs, single quotes, snake_case files, `PascalCase` components
- [ ] On-prem behaviour considered (transport, asset host, cache invalidation)

**Ask before assuming**
- Does this need a new core entity? (→ core change + SDK release + migration)
- Does this need a new `RolePermission`? (→ role seeding in core)
- Does this need RCU/firmware support? (→ hardware dependency, long lead time)
- Does this need a new queue topic or a new service? (→ infra + one of the other 40 repos)
