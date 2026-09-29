"""Browsing and joining Spaces, sidebar sections, public links, tasks in several Lists, and the
content behind the Doc, Whiteboard and Chat views."""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SpaceJoinRequest(Base):
    """Someone asking to be let into a private Space they found on the All Spaces page."""

    __tablename__ = "space_join_requests"
    __table_args__ = (CheckConstraint("status IN ('pending', 'approved', 'declined')", name="status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    message: Mapped[Optional[str]] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="pending")
    decided_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class HiddenSpace(Base):
    """A Space someone has left (hidden from their sidebar). Access is unchanged; it's a personal preference."""

    __tablename__ = "hidden_spaces"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), primary_key=True)


class SidebarSection(Base):
    """A personal heading in the sidebar that groups Spaces ("Clients", "Internal")."""

    __tablename__ = "sidebar_sections"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    orderindex: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    space_ids: Mapped[List[str]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    collapsed: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"), default=False)


class PublicLink(Base):
    """A secret, read-only link to a task, List or view that anyone can open without signing in."""

    __tablename__ = "public_links"
    __table_args__ = (
        CheckConstraint("num_nonnulls(task_id, list_id, view_id) = 1", name="one_target"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token: Mapped[str] = mapped_column(String(48), nullable=False, unique=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), index=True)
    view_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("views.id", ondelete="CASCADE"), index=True)
    # What visitors see besides names and statuses.
    show_description: Mapped[bool] = mapped_column(nullable=False, server_default=text("true"), default=True)
    show_assignees: Mapped[bool] = mapped_column(nullable=False, server_default=text("false"), default=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    views_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)


class TaskListLink(Base):
    """A task that also appears in another List besides its home List (ClickUp's Tasks in Multiple Lists)."""

    __tablename__ = "task_list_links"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True)
    list_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("lists.id", ondelete="CASCADE"), primary_key=True, index=True)
    added_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ViewContent(Base):
    """What a Doc, Whiteboard or Mind map view holds. `version` guards against overwriting someone else's edit."""

    __tablename__ = "view_contents"

    view_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("views.id", ondelete="CASCADE"), primary_key=True)
    content: Mapped[Dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=text("'{}'::jsonb"), default=dict)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_by: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ChatMessage(Base):
    """A message in a Chat view: the conversation that lives next to a Space, Folder or List's tasks."""

    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    view_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("views.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[Optional[str]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))  # turned into a task
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    edited_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))


class InboundEmail(Base):
    """An email sent to a List's address, kept so the same message never makes two tasks."""

    __tablename__ = "inbound_emails"
    __table_args__ = (UniqueConstraint("message_id", name="uq_inbound_emails_message_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    message_id: Mapped[str] = mapped_column(String(300), nullable=False)
    list_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("lists.id", ondelete="SET NULL"))
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))
    sender: Mapped[Optional[str]] = mapped_column(String(320))
    outcome: Mapped[str] = mapped_column(String(40), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
