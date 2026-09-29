import * as React from "react";

interface ComposerProps {
  busy: boolean;
  modeId?: string;
  onModeChange?: (modeId: string) => void;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

/** Max attachments and per-image data-URL size (~4MB) to protect the request. */
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function Composer({ busy, modeId = "auto", onModeChange, onSend, onStop }: ComposerProps) {
  const [text, setText] = React.useState("");
  const [images, setImages] = React.useState<string[]>([]);
  const [note, setNote] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    if (text) {
      el.style.height = Math.min(el.scrollHeight, 220) + "px";
    }
  }, [text]);

  const submit = () => {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || busy) {
      return;
    }
    onSend(trimmed, images);
    setText("");
    setImages([]);
    setNote(null);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const readFile = (file: File) =>
    new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

  /** Add image Files (from picker, paste, or drop), enforcing count/size caps. */
  const addFiles = async (files: File[]) => {
    const incoming = files.filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) {
      return;
    }
    setNote(null);
    const next: string[] = [];
    for (const file of incoming) {
      if (images.length + next.length >= MAX_IMAGES) {
        setNote(`You can attach up to ${MAX_IMAGES} images.`);
        break;
      }
      const url = await readFile(file);
      if (!url) {
        continue;
      }
      if (url.length > MAX_IMAGE_BYTES) {
        setNote(`"${file.name || "image"}" is too large (max 4MB).`);
        continue;
      }
      next.push(url);
    }
    if (next.length) {
      setImages((prev) => [...prev, ...next]);
    }
  };

  const onFiles = async (fileList: FileList | null) => {
    if (fileList) {
      await addFiles(Array.from(fileList));
    }
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
      .map((it) => it.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length) {
      e.preventDefault();
      void addFiles(files);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.some((f) => f.type.startsWith("image/"))) {
      e.preventDefault();
      setDragging(false);
      void addFiles(files);
    }
  };

  const removeImage = (idx: number) =>
    setImages((prev) => prev.filter((_, i) => i !== idx));

  return (
    <div className="composer">
      {images.length > 0 && (
        <div className="attachments">
          {images.map((src, i) => (
            <div className="attachment" key={i}>
              <img src={src} alt={`attachment ${i + 1}`} />
              <button
                className="attachment-remove"
                title="Remove"
                onClick={() => removeImage(i)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {note && <div className="composer-note">{note}</div>}

      {/* Floating Dark Glass Capsule Prompt Box (Image 4) */}
      <div
        className={`composer-capsule${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          if (Array.from(e.dataTransfer?.items ?? []).some((it) => it.kind === "file")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => onFiles(e.target.files)}
        />

        {/* Top row with @ circular button */}
        <div className="composer-top-row">
          <button
            type="button"
            className="composer-at-circle"
            title="Attach image or add reference (@)"
            onClick={() => fileRef.current?.click()}
          >
            <span>@</span>
          </button>
        </div>

        {/* Textarea */}
        <textarea
          ref={ref}
          className="composer-prompt-textarea"
          placeholder={dragging ? "Drop image to attach…" : "Build anything..."}
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />

        {/* Bottom row: Circular send arrow on right */}
        <div className="composer-bottom-row">
          <div className="composer-send-cluster">
            {busy ? (
              <button
                type="button"
                className="composer-circle-submit stop"
                onClick={onStop}
                title="Stop generation"
              >
                ■
              </button>
            ) : (
              <button
                type="button"
                className="composer-circle-submit send"
                onClick={submit}
                disabled={!text.trim() && images.length === 0}
                title="Send (Enter)"
              >
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
