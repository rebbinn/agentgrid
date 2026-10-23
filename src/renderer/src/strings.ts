export const strings = {
  appName: 'AgentGrid',
  tagline: 'Bir iş sahəsində bir neçə AI agent terminalı',
  pendingEngine: 'Terminal mühərriki 3-cü mərhələdə əlavə olunur',
  header: {
    openProject: 'Layihə qovluğu seç',
    noProject: 'Layihə seçilməyib',
    layout: 'Düzülüş',
    newTerminal: 'Yeni terminal'
  },
  rail: {
    claude: 'Claude (yeni terminal)',
    toggleSidebar: 'Yan paneli göstər / gizlət'
  },
  sidebar: {
    project: 'Layihə',
    recent: 'Son açılanlar',
    noRecent: 'Hələ başqa layihə açılmayıb.'
  },
  empty: {
    noProjectTitle: 'Başlamaq üçün layihə qovluğunu seçin',
    noProjectText: 'Terminallar seçdiyiniz qovluqda açılacaq.',
    noTerminalsTitle: 'Hələ terminal yoxdur',
    noTerminalsText: 'Solda Claude düyməsinə basanda yeni terminal açılacaq.',
    pickProject: 'Layihə qovluğu seç',
    startClaude: 'Claude başlat'
  },
  status: {
    terminals: (count: number) => `${count} terminal`,
    ready: 'Hazır'
  },
  toast: {
    projectOpened: (name: string) => `Layihə açıldı: ${name}`,
    projectPickFailed: 'Qovluq seçmək alınmadı',
    dismiss: 'Bağla'
  }
} as const
