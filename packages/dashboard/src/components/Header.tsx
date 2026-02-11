interface HeaderProps {
  runeCount: number;
}

export function Header({ runeCount }: HeaderProps) {
  return (
    <header className="border-b border-heimdall-border bg-heimdall-surface px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">&#9876;&#65039;</span>
        <div>
          <h1 className="text-gold font-bold text-lg tracking-wider">
            HEIMDALL WATCHTOWER
          </h1>
          <p className="text-gray-500 text-xs">
            The guardian between AI agents and their tools
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-sm text-gray-400">
          <span className="text-gold font-mono">{runeCount}</span> runes
          inscribed
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-green-400">Guarding</span>
        </div>
      </div>
    </header>
  );
}
