import * as React from "react";

interface ComposerProps {
  busy: boolean;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

/** Max attachments and per-image data-URL size (~4MB) to protect the request. */
const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function Composer({ busy, onSend, onStop }: ComposerProps) {
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
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
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
      <div
        className={`composer-box${dragging ? " dragging" : ""}`}
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
        <textarea
          ref={ref}
          className="composer-input"
          placeholder={
            dragging
              ? "Drop image to attach…"
              : "Ask anything, or describe a change…"
          }
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div className="composer-actions">
          <button
            className="composer-attach"
            title="Attach image"
            onClick={() => fileRef.current?.click()}
          >
            📎
          </button>
          <span className="composer-hint">
            <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
          </span>
          {busy ? (
            <button className="composer-btn composer-btn-stop" onClick={onStop} title="Stop">
              ■
            </button>
          ) : (
            <button
              className="composer-btn composer-btn-send"
              onClick={submit}
              disabled={!text.trim() && images.length === 0}
              title="Send (Enter)"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
