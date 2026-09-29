import * as React from "react";
import type { ChatSummary } from "../../shared/protocol";
import { AxiomIcon } from "./AxiomIcon";
import { UserAvatar } from "./UserAvatar";

interface ChatListProps {
  chats: ChatSummary[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

export interface FolderGroup {
  id: string;
  name: string;
  color: "cyan" | "yellow" | "pink" | "purple" | "emerald" | "blue";
  chatIds: string[];
}

export function ChatList({
  chats,
  activeId,
  onSelect,
  onDelete,
  onNew,
  onClose,
}: ChatListProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [pinnedOpen, setPinnedOpen] = React.useState(true);
  const [chatsOpen, setChatsOpen] = React.useState(true);
  const [menuOpenId, setMenuOpenId] = React.useState<string | null>(null);

  // Folder groups with localStorage persistence
  const [folders, setFolders] = React.useState<FolderGroup[]>(() => {
    try {
      const saved = localStorage.getItem("axiom_chat_folders_v1");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [
      { id: "g-general", name: "General", color: "cyan", chatIds: [] },
      { id: "g-design", name: "Design", color: "yellow", chatIds: [] },
      { id: "g-mgmt", name: "Management", color: "pink", chatIds: [] },
    ];
  });

  const [expandedFolders, setExpandedFolders] = React.useState<Record<string, boolean>>({
    "g-general": true,
  });
  const [isCreatingFolder, setIsCreatingFolder] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [newFolderColor, setNewFolderColor] = React.useState<FolderGroup["color"]>("blue");
  const [folderMenuId, setFolderMenuId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      localStorage.setItem("axiom_chat_folders_v1", JSON.stringify(folders));
    } catch {}
  }, [folders]);

  const handleCreateFolder = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const newFolder: FolderGroup = {
      id: "g-" + Date.now(),
      name: trimmed,
      color: newFolderColor,
      chatIds: [],
    };
    setFolders((prev) => [...prev, newFolder]);
    setNewFolderName("");
    setIsCreatingFolder(false);
    setExpandedFolders((prev) => ({ ...prev, [newFolder.id]: true }));
  };

  const handleDeleteFolder = (folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId));
    setFolderMenuId(null);
  };

  const toggleChatInFolder = (folderId: string, chatId: string) => {
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id === folderId) {
          const exists = f.chatIds.includes(chatId);
          return {
            ...f,
            chatIds: exists ? f.chatIds.filter((id) => id !== chatId) : [...f.chatIds, chatId],
          };
        }
        return f;
      })
    );
  };

  const removeChatFromFolder = (folderId: string, chatId: string) => {
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, chatIds: f.chatIds.filter((id) => id !== chatId) } : f))
    );
  };

  const filteredChats = React.useMemo(() => {
    if (!searchQuery.trim()) return chats;
    return chats.filter((c) =>
      (c.title || "New Chat").toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [chats, searchQuery]);

  // Group chats by date
  const groups = React.useMemo(() => {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const today: ChatSummary[] = [];
    const yesterday: ChatSummary[] = [];
    const last7Days: ChatSummary[] = [];
    const older: ChatSummary[] = [];

    filteredChats.forEach((chat) => {
      const diff = now - (chat.createdAt || now);
      if (diff < oneDay) {
        today.push(chat);
      } else if (diff < 2 * oneDay) {
        yesterday.push(chat);
      } else if (diff < 7 * oneDay) {
        last7Days.push(chat);
      } else {
        older.push(chat);
      }
    });

    return [
      { label: "Today", items: today },
      { label: "Yesterday", items: yesterday },
      { label: "Last 7 days", items: last7Days },
      { label: "Older", items: older },
    ].filter((g) => g.items.length > 0);
  }, [filteredChats]);

  return (
    <div className="sidebar-backdrop" onClick={onClose}>
      <aside className="chat-sidebar" onClick={(e) => e.stopPropagation()}>
        {/* Top bar with 6-dot Axiom icon and close */}
        <div className="sidebar-top-bar">
          <div className="sidebar-brand-cluster">
            <AxiomIcon size={20} color="#F4F7FB" />
            <span className="sidebar-brand-name">Axiom</span>
          </div>
          <button
            className="sidebar-icon-btn"
            onClick={onClose}
            title="Close sidebar"
            aria-label="Close sidebar"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="sidebar-content-scroll">
          {/* Quick Actions Card */}
          <div className="sidebar-nav-card">
            <button
              className="sidebar-new-btn"
              onClick={() => {
                onNew();
                onClose();
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              <span>New Chat</span>
            </button>

            <div className="sidebar-search-box">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="sidebar-search-input"
              />
              {searchQuery && (
                <button className="sidebar-clear-search" onClick={() => setSearchQuery("")}>
                  ✕
                </button>
              )}
            </div>

            <div className="sidebar-nav-links">
              <button
                className="sidebar-nav-link"
                onClick={() => {
                  onNew();
                  onClose();
                }}
                title="Start a new chat"
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <span>Home</span>
              </button>

              <button className="sidebar-nav-link active">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
                <span>Chats</span>
              </button>
            </div>
          </div>

          {/* Pinned Folders section with functional groups */}
          <div className="sidebar-section">
            <div className="sidebar-section-header" onClick={() => setPinnedOpen(!pinnedOpen)}>
              <div className="sidebar-section-title-wrap">
                <span className={`section-chevron ${pinnedOpen ? "open" : ""}`}>›</span>
                <span className="sidebar-section-title">Pinned Folders</span>
                <span className="sidebar-count-badge">{folders.length}</span>
              </div>
              <div className="sidebar-section-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="section-mini-btn"
                  title="Add Folder"
                  onClick={() => setIsCreatingFolder(true)}
                >
                  ＋
                </button>
              </div>
            </div>

            {/* Inline Folder Creation Form */}
            {pinnedOpen && isCreatingFolder && (
              <div className="folder-create-box">
                <input
                  type="text"
                  className="folder-create-input"
                  placeholder="Group name..."
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateFolder();
                    if (e.key === "Escape") setIsCreatingFolder(false);
                  }}
                />
                <div className="folder-color-picker">
                  {(["blue", "cyan", "yellow", "pink", "purple", "emerald"] as const).map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`folder-color-dot ${color} ${newFolderColor === color ? "selected" : ""}`}
                      onClick={() => setNewFolderColor(color)}
                    />
                  ))}
                </div>
                <div className="folder-create-actions">
                  <button className="folder-btn-cancel" onClick={() => setIsCreatingFolder(false)}>
                    Cancel
                  </button>
                  <button className="folder-btn-save" onClick={handleCreateFolder}>
                    Add
                  </button>
                </div>
              </div>
            )}

            {pinnedOpen && (
              <div className="sidebar-folders-list">
                {folders.length === 0 ? (
                  <div className="sidebar-empty-state">No folders created</div>
                ) : (
                  folders.map((folder) => {
                    const isExpanded = !!expandedFolders[folder.id];
                    const isMenuOpen = folderMenuId === folder.id;
                    const folderChats = chats.filter((c) => folder.chatIds.includes(c.id));

                    return (
                      <div key={folder.id} className="folder-group-wrapper">
                        <div
                          className="folder-item"
                          onClick={() =>
                            setExpandedFolders((prev) => ({
                              ...prev,
                              [folder.id]: !isExpanded,
                            }))
                          }
                        >
                          <span className={`folder-chevron ${isExpanded ? "open" : ""}`}>›</span>
                          <span className={`folder-indicator ${folder.color}`} />
                          <svg className="folder-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span className="folder-name">{folder.name}</span>
                          <span className="folder-item-count">{folderChats.length}</span>

                          <button
                            className="folder-more"
                            title="Folder options"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFolderMenuId(isMenuOpen ? null : folder.id);
                            }}
                          >
                            ···
                          </button>

                          {isMenuOpen && (
                            <div className="folder-dropdown" onClick={(e) => e.stopPropagation()}>
                              <button
                                className="folder-dropdown-item danger"
                                onClick={() => handleDeleteFolder(folder.id)}
                              >
                                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                                <span>Delete Folder</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Nested Chats in this folder */}
                        {isExpanded && (
                          <div className="folder-chats-sublist">
                            {folderChats.length === 0 ? (
                              <div className="folder-empty-hint">No chats in this folder yet</div>
                            ) : (
                              folderChats.map((c) => (
                                <div
                                  key={c.id}
                                  className={`folder-chat-item ${c.id === activeId ? "active" : ""}`}
                                  onClick={() => {
                                    onSelect(c.id);
                                    onClose();
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                                  </svg>
                                  <span className="folder-chat-title">{c.title || "New Chat"}</span>
                                  <button
                                    className="folder-chat-remove-btn"
                                    title="Remove from folder"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeChatFromFolder(folder.id, c.id);
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Chats Section with Grouping and Folder assignment */}
          <div className="sidebar-section">
            <div className="sidebar-section-header" onClick={() => setChatsOpen(!chatsOpen)}>
              <div className="sidebar-section-title-wrap">
                <span className={`section-chevron ${chatsOpen ? "open" : ""}`}>›</span>
                <span className="sidebar-section-title">All Chats</span>
                <span className="sidebar-count-badge">{chats.length}</span>
              </div>
              <div className="sidebar-section-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className="section-mini-btn"
                  title="New chat"
                  onClick={() => {
                    onNew();
                    onClose();
                  }}
                >
                  ＋
                </button>
              </div>
            </div>

            {chatsOpen && (
              <div className="sidebar-chats-list">
                {chats.length === 0 ? (
                  <div className="sidebar-empty-state">No conversations yet</div>
                ) : groups.length === 0 ? (
                  <div className="sidebar-empty-state">No matching chats</div>
                ) : (
                  groups.map((group) => (
                    <div key={group.label} className="chat-date-group">
                      <div className="chat-date-label">{group.label}</div>
                      {group.items.map((c) => {
                        const isActive = c.id === activeId;
                        const isMenuOpen = menuOpenId === c.id;
                        return (
                          <div
                            key={c.id}
                            className={`sidebar-chat-item ${isActive ? "active" : ""}`}
                            onClick={() => {
                              onSelect(c.id);
                              onClose();
                            }}
                          >
                            <svg className="chat-bubble-svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            <span className="sidebar-chat-title">{c.title || "New Chat"}</span>

                            <div
                              className="chat-item-actions"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpenId(isMenuOpen ? null : c.id);
                              }}
                            >
                              <button className="chat-item-more-btn" title="Options">···</button>
                              {isMenuOpen && (
                                <div className="chat-item-dropdown" onClick={(e) => e.stopPropagation()}>
                                  <div className="chat-dropdown-header">Move to Folder:</div>
                                  {folders.map((f) => {
                                    const inFolder = f.chatIds.includes(c.id);
                                    return (
                                      <button
                                        key={f.id}
                                        className={`chat-item-dropdown-item ${inFolder ? "in-folder" : ""}`}
                                        onClick={() => toggleChatInFolder(f.id, c.id)}
                                      >
                                        <span className={`folder-indicator ${f.color}`} />
                                        <span className="dropdown-folder-name">{f.name}</span>
                                        {inFolder && <span className="dropdown-check">✓</span>}
                                      </button>
                                    );
                                  })}

                                  <div className="chat-dropdown-divider" />

                                  <button
                                    className="chat-item-dropdown-item danger"
                                    onClick={() => {
                                      onDelete(c.id);
                                      setMenuOpenId(null);
                                    }}
                                  >
                                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                                      <polyline points="3 6 5 6 21 6" />
                                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                    </svg>
                                    <span>Delete</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Bottom Profile / Footer bar (from Image 5) */}
        <div className="sidebar-footer-profile">
          <div className="sidebar-profile-left">
            <UserAvatar size={24} />
            <div className="sidebar-profile-meta">
              <div className="sidebar-profile-name-row">
                <span className="sidebar-profile-name">Developer</span>
                <span className="sidebar-verified-badge" title="Verified">✔</span>
              </div>
            </div>
          </div>
          <div className="sidebar-profile-right">
            <span className="sidebar-pro-badge">⚡ PRO</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default ChatList;
