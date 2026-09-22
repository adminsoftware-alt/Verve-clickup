"""The permission resolver in isolation: no database needed."""

import uuid

from app.db.models import LocationKind, PermissionLevel, WorkspaceRole
from app.services.work.permissions import Node, resolve_level

ME, OTHER = "me", "other"
FULL, EDIT, VIEW = PermissionLevel.full, PermissionLevel.edit, PermissionLevel.view


def node(kind, *, private=False, creator=OTHER):
    return Node(kind, uuid.uuid4(), creator, private)


def chain(private_space=False, private_list=False, list_creator=OTHER):
    lst = node(LocationKind.list, private=private_list, creator=list_creator)
    space = node(LocationKind.space, private=private_space)
    return [lst, space]


def test_member_gets_full_on_public_items():
    assert resolve_level(chain(), ME, WorkspaceRole.member, {}) == FULL


def test_non_member_gets_nothing():
    assert resolve_level(chain(), ME, None, {}) is None


def test_guest_gets_nothing_without_a_share():
    assert resolve_level(chain(), ME, WorkspaceRole.guest, {}) is None


def test_private_item_is_hidden_even_from_admins():
    assert resolve_level(chain(private_list=True), ME, WorkspaceRole.admin, {}) is None


def test_private_ancestor_hides_public_children():
    assert resolve_level(chain(private_space=True), ME, WorkspaceRole.member, {}) is None


def test_creator_always_has_full_access():
    assert resolve_level(chain(private_list=True, list_creator=ME), ME, WorkspaceRole.guest, {}) == FULL


def test_share_opens_a_private_item():
    c = chain(private_list=True)
    shares = {(c[0].kind, c[0].id): EDIT}
    assert resolve_level(c, ME, WorkspaceRole.member, shares) == EDIT


def test_share_below_a_private_ancestor_still_grants_access():
    c = chain(private_space=True)
    shares = {(c[0].kind, c[0].id): VIEW}
    assert resolve_level(c, ME, WorkspaceRole.member, shares) == VIEW


def test_share_narrows_access_on_a_public_item():
    c = chain()
    shares = {(c[0].kind, c[0].id): VIEW}
    assert resolve_level(c, ME, WorkspaceRole.member, shares) == VIEW


def test_most_specific_share_wins():
    c = chain()
    shares = {(c[0].kind, c[0].id): VIEW, (c[1].kind, c[1].id): FULL}
    assert resolve_level(c, ME, WorkspaceRole.member, shares) == VIEW


def test_guests_never_get_access_through_a_space():
    c = chain()
    shares = {(c[1].kind, c[1].id): EDIT}
    assert resolve_level(c, ME, WorkspaceRole.guest, shares) is None
    assert resolve_level(c, ME, WorkspaceRole.guest, {}, team_shares=shares) is None


def test_guest_with_a_list_share_reaches_the_list():
    c = chain(private_space=True)
    shares = {(c[0].kind, c[0].id): EDIT}
    assert resolve_level(c, ME, WorkspaceRole.guest, shares) == EDIT


# --- Teams -------------------------------------------------------------------


def test_team_share_opens_a_private_item():
    c = chain(private_list=True)
    teams = {(c[0].kind, c[0].id): EDIT}
    assert resolve_level(c, ME, WorkspaceRole.member, {}, teams) == EDIT


def test_personal_share_beats_team_share_on_the_same_node():
    c = chain()
    key = (c[0].kind, c[0].id)
    assert resolve_level(c, ME, WorkspaceRole.member, {key: VIEW}, {key: FULL}) == VIEW


def test_team_share_on_a_more_specific_node_beats_a_personal_share_above():
    c = chain()
    personal = {(c[1].kind, c[1].id): VIEW}
    teams = {(c[0].kind, c[0].id): EDIT}
    assert resolve_level(c, ME, WorkspaceRole.member, personal, teams) == EDIT


def test_permission_levels_are_ordered():
    assert FULL.at_least(EDIT) and EDIT.at_least(VIEW) and not VIEW.at_least(EDIT)
