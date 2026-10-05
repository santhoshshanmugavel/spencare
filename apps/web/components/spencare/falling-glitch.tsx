"use client";

import type { ReactNode } from "react";
import { useRef, useEffect, useCallback, useMemo } from "react";

/**
 * Full-bleed animated backdrop: columns of monospace characters that
 * fall down the viewport, periodically swapping to a random character
 * from a small set and recoloring from a provided palette. Children
 * render centered above the canvas.
 *
 * This is a purely decorative surface -- used by the app's 404 page --
 * so it does not announce itself to assistive tech. Screen readers
 * read the children (the "404" heading + CTA) directly.
 */

export interface FallingGlitchProps {
  glitchColors?: string[];
  fontSize?: number;
  backgroundColor?: string;
  glitchSpeed?: number;
  glitchIntensity?: number;
  fallSpeed?: number;
  outerVignette?: boolean;
  children?: ReactNode;
}

interface Letter {
  char: string;
  x: number;
  y: number;
  color: string;
}

export function FallingGlitch({
  glitchColors = ["#ff7cce", "#7cf0ff", "#fcf07c", "#8E44AD", "#3498DB"],
  fontSize = 14,
  backgroundColor = "#080A12",
  glitchSpeed = 50,
  glitchIntensity = 0.05,
  fallSpeed = 0.75,
  outerVignette = true,
  children,
}: FallingGlitchProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameId = useRef<number | null>(null);
  const grid = useRef({ columns: 0, rows: 0, charWidth: 0, charHeight: 0 });
  const letters = useRef<Letter[]>([]);
  const lastGlitchTime = useRef(0);

  const characterSet = useMemo(() => '.:*+=#%@",', []);
  const getRandomChar = useCallback(
    () => characterSet[Math.floor(Math.random() * characterSet.length)]!,
    [characterSet],
  );
  const getRandomColor = useCallback(
    () => glitchColors[Math.floor(Math.random() * glitchColors.length)]!,
    [glitchColors],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let canvasWidth = 0;
    let canvasHeight = 0;

    const setup = () => {
      if (animationFrameId.current !== null) cancelAnimationFrame(animationFrameId.current);
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvasWidth = rect.width;
      canvasHeight = rect.height;
      canvas.width = canvasWidth * dpr;
      canvas.height = canvasHeight * dpr;
      canvas.style.width = `${canvasWidth}px`;
      canvas.style.height = `${canvasHeight}px`;
      ctx.scale(dpr, dpr);
      ctx.font = `${fontSize}px monospace`;
      const charMetrics = ctx.measureText("M");
      grid.current = {
        columns: Math.floor(canvasWidth / charMetrics.width),
        rows: Math.floor(canvasHeight / (fontSize * 1.2)),
        charWidth: charMetrics.width,
        charHeight: fontSize * 1.2,
      };
      const extendedRows = grid.current.rows * 2;
      const totalLetters = grid.current.columns * extendedRows;
      letters.current = Array.from({ length: totalLetters }, (_, i) => {
        const col = i % grid.current.columns;
        const row = Math.floor(i / grid.current.columns);
        return {
          char: getRandomChar(),
          x: col * grid.current.charWidth,
          y: row * grid.current.charHeight - grid.current.rows * grid.current.charHeight,
          color: getRandomColor(),
        };
      });
      animationFrameId.current = requestAnimationFrame(animate);
    };

    const animate = (timestamp: number) => {
      animationFrameId.current = requestAnimationFrame(animate);
      if (timestamp - lastGlitchTime.current > glitchSpeed) {
        lastGlitchTime.current = timestamp;
        const updateCount = Math.floor(letters.current.length * glitchIntensity);
        for (let i = 0; i < updateCount; i++) {
          const index = Math.floor(Math.random() * letters.current.length);
          if (letters.current[index]) {
            letters.current[index]!.char = getRandomChar();
            letters.current[index]!.color = getRandomColor();
          }
        }
      }
      const totalFieldHeight = grid.current.rows * grid.current.charHeight * 2;
      for (const letter of letters.current) {
        letter.y += fallSpeed;
        if (letter.y > canvasHeight) {
          letter.y -= totalFieldHeight;
        }
      }
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      ctx.font = `${fontSize}px monospace`;
      ctx.textBaseline = "top";
      for (const letter of letters.current) {
        ctx.fillStyle = letter.color;
        ctx.fillText(letter.char, letter.x, letter.y);
      }
    };

    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(setup, 150);
    };
    window.addEventListener("resize", handleResize);
    setup();
    return () => {
      window.removeEventListener("resize", handleResize);
      if (animationFrameId.current !== null) cancelAnimationFrame(animationFrameId.current);
    };
  }, [
    glitchColors,
    fontSize,
    backgroundColor,
    glitchSpeed,
    glitchIntensity,
    fallSpeed,
    getRandomChar,
    getRandomColor,
  ]);

  return (
    <div ref={containerRef} className="relative h-full w-full bg-black">
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />
      {outerVignette ? (
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle,_transparent_70%,_black_100%)]" />
      ) : null}
      <div className="relative z-10 flex h-full w-full items-center justify-center">{children}</div>
    </div>
  );
}
