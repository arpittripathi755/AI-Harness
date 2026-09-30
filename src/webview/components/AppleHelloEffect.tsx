import * as React from "react";

export type HelloProps = React.SVGProps<SVGSVGElement> & {
  speed?: number;
  onAnimationComplete?: () => void;
};

export function AppleHelloEnglishEffect({
  className,
  speed = 1,
  onAnimationComplete,
  style,
  ...props
}: HelloProps) {
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      onAnimationComplete?.();
    }, 2400 * speed);
    return () => window.clearTimeout(timer);
  }, [speed, onAnimationComplete]);

  return (
    <svg
      className={["apple-hello-svg", className].filter(Boolean).join(" ")}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 638 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="14.8883"
      {...props}
    >
      <title>hello</title>
      <style>{`
        @keyframes drawHello1 {
          0% { stroke-dashoffset: 750; opacity: 0; }
          20% { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 1; }
        }
        @keyframes drawHello2 {
          0% { stroke-dashoffset: 3600; opacity: 0; }
          20% { opacity: 1; }
          100% { stroke-dashoffset: 0; opacity: 1; }
        }
        .hello-stroke-1 {
          stroke-dasharray: 750;
          stroke-dashoffset: 750;
          animation: drawHello1 ${0.8 * speed}s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        .hello-stroke-2 {
          stroke-dasharray: 3600;
          stroke-dashoffset: 3600;
          animation: drawHello2 ${1.8 * speed}s cubic-bezier(0.4, 0, 0.2, 1) ${0.5 * speed}s forwards;
        }
      `}</style>

      {/* h1 */}
      <path
        className="hello-stroke-1"
        d="M8.69214 166.553C36.2393 151.239 61.3409 131.548 89.8191 98.0295C109.203 75.1488 119.625 49.0228 120.122 31.0026C120.37 17.6036 113.836 7.43883 101.759 7.43883C88.3598 7.43883 79.9231 17.6036 74.7122 40.9363C69.005 66.5793 64.7866 96.0036 54.1166 190.356"
        style={{ strokeLinecap: "round" }}
      />

      {/* h2, ello */}
      <path
        className="hello-stroke-2"
        d="M55.1624 181.135C60.6251 133.114 81.4118 98.0479 107.963 98.0479C123.844 98.0479 133.937 110.703 131.071 128.817C129.457 139.487 127.587 150.405 125.408 163.06C122.869 178.941 130.128 191.348 152.122 191.348C184.197 191.348 219.189 173.523 237.097 145.915C243.198 136.509 245.68 128.073 245.928 119.884C246.176 104.996 237.739 93.8296 222.851 93.8296C203.992 93.8296 189.6 115.17 189.6 142.465C189.6 171.745 205.481 192.341 239.208 192.341C285.066 192.341 335.86 137.292 359.199 75.8585C365.788 58.513 368.26 42.4065 368.26 31.1512C368.26 17.8057 364.042 7.55823 352.131 7.55823C340.469 7.55823 332.777 16.6141 325.829 30.9129C317.688 47.4967 311.667 71.4162 309.203 98.4549C303 166.301 316.896 191.348 349.936 191.348C390 191.348 434.542 135.534 457.286 75.6686C463.803 58.513 466.275 42.4065 466.275 31.1512C466.275 17.8057 462.057 7.55823 450.146 7.55823C438.484 7.55823 430.792 16.6141 423.844 30.9129C415.703 47.4967 409.682 71.4162 407.218 98.4549C401.015 166.301 414.911 191.348 444.416 191.348C473.874 191.348 489.877 165.67 499.471 138.402C508.955 111.447 520.618 94.8221 544.935 94.8221C565.035 94.8221 580.916 109.71 580.916 137.75C580.916 168.768 560.792 192.093 535.362 192.341C512.984 192.589 498.285 174.475 499.774 147.179C501.511 116.907 519.873 94.8221 543.943 94.8221C557.839 94.8221 569.51 100.999 578.682 107.725C603.549 125.866 622.709 114.656 630.047 96.7186"
        style={{ strokeLinecap: "round" }}
      />
    </svg>
  );
}

export function AppleHelloVietnameseEffect({
  className,
  speed = 1,
  onAnimationComplete,
  style,
  ...props
}: HelloProps) {
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      onAnimationComplete?.();
    }, 2400 * speed);
    return () => window.clearTimeout(timer);
  }, [speed, onAnimationComplete]);

  return (
    <svg
      className={["apple-hello-svg", className].filter(Boolean).join(" ")}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1009 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="14.8883"
      {...props}
    >
      <title>xin chào</title>
      <path
        d="M102.233 96.2277C75.6823 127.245 45.1612 158.759 11.4143 190.521"
        style={{ strokeLinecap: "round" }}
      />
      <path
        d="M12.3888 95.8379C41.2461 127.502 69.839 157.067 101.442 189.176"
        style={{ strokeLinecap: "round" }}
      />
      <path
        d="M141.205 60.1039C141.205 64.9126 137.307 68.8105 132.498 68.8105C127.69 68.8105 123.792 64.9126 123.792 60.1039C123.792 55.2952 127.69 51.3973 132.498 51.3973C137.307 51.3973 141.205 55.2952 141.205 60.1039Z"
        fill="currentColor"
      />
      <path
        d="M132.498 94.6685V189.176"
        style={{ strokeLinecap: "round" }}
      />
      <path
        d="M172.934 94.6685V189.176"
        style={{ strokeLinecap: "round" }}
      />
    </svg>
  );
}

export function AxiomHelloEffect({
  className,
  speed = 1,
  onAnimationComplete,
  style,
  ...props
}: HelloProps) {
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      onAnimationComplete?.();
    }, 2000 * speed);
    return () => window.clearTimeout(timer);
  }, [speed, onAnimationComplete]);

  return (
    <svg
      className={["apple-hello-svg", className].filter(Boolean).join(" ")}
      style={style}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 800 200"
      fill="none"
      stroke="currentColor"
      strokeWidth="13"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <title>Axiom</title>
      <path d="M30 175 L75 30 L120 175 M47 118 L103 118" />
      <path d="M148 68 L202 155 M202 68 L148 155" />
      <path d="M249 42 L249 46 M249 72 L249 155" strokeWidth="16" />
      <path d="M330 112 C330 78 314 62 296 62 C278 62 262 78 262 112 C262 146 278 162 296 162 C314 162 330 146 330 112 Z" />
      <path d="M358 68 L358 155 M358 88 C358 72 372 62 388 62 C404 62 414 72 414 90 L414 155 M414 88 C414 72 428 62 444 62 C460 62 470 72 470 90 L470 155" />
    </svg>
  );
}
