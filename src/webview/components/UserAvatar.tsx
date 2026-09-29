import * as React from "react";

interface UserAvatarProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

/**
 * Modern developer user avatar SVG replacing the old plain text "YOU" block.
 */
export function UserAvatar({
  size = 20,
  className = "",
  ...props
}: UserAvatarProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={`user-avatar-svg ${className}`.trim()}
      {...props}
    >
      <circle cx="12" cy="12" r="11" fill="rgba(77, 141, 255, 0.12)" stroke="rgba(77, 141, 255, 0.35)" strokeWidth="1.2" />
      {/* Head */}
      <circle cx="12" cy="8.5" r="3.4" fill="#8DB5FF" />
      {/* Shoulders / Torso */}
      <path
        d="M6.5 17.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8"
        stroke="#8DB5FF"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default UserAvatar;
