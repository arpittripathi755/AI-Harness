import * as React from "react";
import Markdown from "react-markdown";
import type { UiMessage } from "../../shared/protocol";
import { AxiomIcon } from "./AxiomIcon";
import { UserAvatar } from "./UserAvatar";

interface MessageItemProps {
  message: UiMessage;
  streaming?: boolean;
}

export function MessageItem({ message, streaming }: MessageItemProps) {
  const isUser = message.role === "user";
  return (
    <div className={`msg msg-${message.role}`}>
      <div className="msg-avatar" aria-hidden="true">
        {isUser ? <UserAvatar size={22} /> : <AxiomIcon size={18} color="#4D8DFF" />}
      </div>
      <div className="msg-content">
        {message.images && message.images.length > 0 && (
          <div className="msg-images">
            {message.images.map((src, i) => (
              <img key={i} className="msg-image" src={src} alt={`attachment ${i + 1}`} />
            ))}
          </div>
        )}
        <div className="msg-body">
          {isUser ? (
            <span className="msg-text">{message.content}</span>
          ) : (
            <Markdown>{message.content}</Markdown>
          )}
          {streaming && <span className="cursor">▍</span>}
        </div>
      </div>
    </div>
  );
}
