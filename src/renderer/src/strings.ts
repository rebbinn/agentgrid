import type { TerminalErrorCode } from '@shared/ipc'

export const strings = {
  appName: 'AgentGrid',
  tagline: 'Bir iş sahəsində bir neçə AI agent terminalı',
  pendingLayout: 'Düzülüş seçimi 4-cü mərhələdə əlavə olunur',
  header: {
    openProject: 'Layihə qovluğu seç',
    noProject: 'Layihə seçilməyib',
    layout: 'Düzülüş',
    newTerminal: 'Yeni terminal',
    chooseShell: 'Başqa shell ilə aç'
  },
  rail: {
    claude: 'Claude (yeni terminal)',
    claudeTip: 'Claude — yeni CMD-də işə sal',
    toggleSidebar: 'Yan paneli göstər / gizlət'
  },
  sidebar: {
    project: 'Layihə',
    recent: 'Son açılanlar',
    noRecent: 'Hələ başqa layihə açılmayıb.'
  },
  empty: {
    noProjectText:
      'Layihə seçilməyib, terminallar ev qovluğunuzda açılacaq. İstəsəniz layihə qovluğunu seçin.',
    noTerminalsTitle: 'Hələ terminal yoxdur',
    noTerminalsText: 'Solda Claude düyməsinə basanda yeni CMD açılıb içində Claude işə düşəcək.',
    pickProject: 'Layihə qovluğu seç',
    startClaude: 'Claude başlat',
    plainTerminal: 'Boş terminal aç'
  },
  status: {
    terminals: (count: number) => `${count} terminal`,
    ready: 'Hazır',
    active: (title: string) => `Aktiv: ${title}`
  },
  terminal: {
    launchFailed: 'Terminal açmaq alınmadı',
    noShell: 'Bu kompüterdə heç bir shell tapılmadı',
    states: {
      starting: 'Başlayır',
      running: 'İşləyir',
      exited: 'Bitib',
      error: 'Xəta'
    },
    exitedBar: (code: number) => `Proses bitdi (çıxış kodu ${code})`,
    restart: 'Yenidən başlat',
    retry: 'Yenidən cəhd et',
    clear: 'Ekranı təmizlə',
    close: 'Bağla',
    errorTitle: 'Terminal başlamadı',
    paneLabel: (title: string) => `Terminal: ${title}`,
    errorText: (code: TerminalErrorCode, detail: string): string => {
      switch (code) {
        case 'cwd-missing':
          return `Layihə qovluğu tapılmadı: ${detail}`
        case 'shell-missing':
          return `Seçilmiş shell tapılmadı: ${detail}`
        case 'agent-missing':
          return `"${detail}" proqramı quraşdırılmayıb və ya PATH-də yoxdur. Quraşdırdıqdan sonra yenidən cəhd edin.`
        case 'duplicate-id':
          return 'Bu terminal artıq açılıb.'
        case 'spawn-failed':
          return `Proses işə düşmədi: ${detail}`
      }
    }
  },
  confirmClose: {
    title: 'Terminal bağlansın?',
    text: (title: string) =>
      `"${title}" hələ işləyir. Bağlasanız, içindəki proses dayandırılacaq və yazılmamış iş itə bilər.`,
    confirm: 'Bağla',
    cancel: 'Ləğv et'
  },
  toast: {
    projectOpened: (name: string) => `Layihə açıldı: ${name}`,
    projectPickFailed: 'Qovluq seçmək alınmadı',
    dismiss: 'Bağla'
  }
} as const
