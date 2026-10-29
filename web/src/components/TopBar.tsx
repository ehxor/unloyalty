import type { ComponentChildren } from 'preact';

interface Props {
  title: string;
  /** Where the back arrow goes; omitted on the home screen. */
  back?: string;
  children?: ComponentChildren;
}

export function TopBar({ title, back, children }: Props) {
  return (
    <header class="topbar">
      {back && (
        <a class="icon-button" href={back} aria-label="Back">
          ‹
        </a>
      )}
      <h1>{title}</h1>
      <div class="topbar-actions">{children}</div>
    </header>
  );
}
