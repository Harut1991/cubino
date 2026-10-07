import type { Dictionary } from '../types';

export const en: Dictionary = {
  common: {
    cancelar: 'Cancel',
    fechar: 'Close',
    menu: 'Menu',
    reiniciar: 'Restart',
    moedas: (n) => `${n} ${n === 1 ? 'coin' : 'coins'}`,
    jogadas: (n) => `${n} ${n === 1 ? 'move' : 'moves'}`,
    dicas: (n) => `${n} ${n === 1 ? 'hint' : 'hints'}`,
    telaCheia: 'Fullscreen',
    sairDaTelaCheia: 'Exit fullscreen',
  },

  menu: {
    appTitle: 'Cubino',
    appSubtitle: '',
    continuar: 'Continue',
    jornada: 'Journey',
    diario: 'Daily',
    novoDesafioDisponivel: 'New challenge available',
    completo: 'complete',
    batalhaDeChefao: 'Boss Battle',
    fase: (n) => `Level ${n}`,
    emAndamento: 'in progress',
    lojinha: 'Shop',
    som: 'Sound',
    musicaEEfeitos: 'Music & effects',
    ajustes: 'Settings',
    qualidadeGrafica: 'Graphics quality',
    modalVitoriaDesativado: 'Victory screen disabled',
    reativar: 're-enable',
  },

  hud: {
    chefao: 'Boss',
    chefaoTag: '⚔ Boss',
    diario: 'Daily',
    fase: (n) => `Level ${n}`,
    otimo: (n) => `best: ${n}`,
    otimoInline: (n) => `best ${n}`,
    voltar: (n) => (n < 0 ? 'Undo' : `Undo${n > 0 ? ` (${n})` : ''}`),
    dica: (n) => (n < 0 ? 'Hint' : `Hint${n > 0 ? ` (${n})` : ''}`),
    dicaCalculando: 'Hint…',
    maisTubo: (n) => (n < 0 ? '+Column' : `+Column${n > 0 ? ` (${n})` : ''}`),
    pular: 'Skip →',
    pularFase: 'Skip level →',
    proxima: 'Next',
    repetir: 'Retry',
    somaPrecisa: (n: number) => `Need ${n}`,
    somaAgora: (n: number) => `Current ${n}`,
    anuncioTubo: 'Watch the video to add a column',
    desfazerMoeda: (price) => `Undo ${price}`,
    anuncioDesfazer: 'Watch the video to undo',
    tuboMoeda: (price, n) => `+Column ${price}${n > 0 ? ` (${n})` : ''}`,
    semMoedasTubo: (price) => `Need ${price} coins for the first column`,
    naoMostrarNovamente: "Don't show again",
    semMovimentosDisponiveis: 'No moves available',
    semMovimentosAdicioneTubo: 'No moves — add a column',
    semMovimentosReinicieOuDesfaca: 'No moves — restart or undo',
    semMovimentosReinicieAFase: 'No moves — restart the level',
    semMovimentosTitulo: 'No moves left!',
    naoHaMaisJogadas: 'There are no more possible moves.',
    decantado: 'Victory',
    chefaoDerrotado: '⚔ Boss Defeated!',
    preparandoBatalha: 'Preparing battle…',
    preparandoFase: 'Preparing level…',
    erroPreparandoFase: 'Could not prepare the level. Please try again.',
    carregandoLento: 'Taking longer than expected…',
    tentarNovamente: 'Try again',
  },

  shop: {
    title: 'Shop',
    fundos: 'Backgrounds',
    corDoTubo: 'Tube color',
    formatoDoTubo: 'Tube shape',
    emUso: 'In use',
    equipar: 'Equip',
    gratis: 'Free',
    visualizando: 'Previewing…',
    comprarPor: (price) => `Buy for ${price} coins`,
    saldoInsuficiente: (price) => `${price} coins — not enough coins`,
    verAnuncio: 'Watch',
    moedasAnuncio: (n) => `+${n} coins`,
  },

  ajustes: {
    title: 'Settings',
    qualidade: 'Quality',
    auto: 'Auto',
    alta: 'High',
    baixa: 'Low',
    detecta: 'Detects',
    maisDetalhes: 'More detail',
    maisFluido: 'Smoother',
    idioma: 'Language',
    privacyPolicy: 'Privacy policy',
    zonaDePerigo: 'Danger zone',
    apagarTodosOsDados: 'Delete all data',
    apagando: 'Deleting…',
    simApagarTudo: 'Yes, delete everything',
    apagarConfirmTitle: 'Delete all data?',
    apagarConfirmBody:
      "This deletes your journey progress, coins, shop items, preferences, and the daily " +
      "challenge — everything. It can't be undone. The game reloads from scratch, as if you'd " +
      "never opened it before.",
  },

  sound: {
    title: 'Sound',
    musica: 'Music',
    trilhaSonoraDeFundo: 'Background music',
    faixaDeMusica: 'Music track',
    dinamico: 'Dynamic',
    mudaComADificuldadeDaFase: 'Changes with level difficulty',
    efeitos: 'Effects',
    sonsDeDespejoEInterface: 'Sounds when a cube moves',
    efeitoSonoroDaAgua: 'Cube sound',
  },

  bossIntro: {
    tierN: (n) => `⚔ Boss · Tier ${n}`,
    recuar: 'Retreat',
    enfrentar: 'Fight!',
  },

  modeSelector: {
    jornada: 'Journey',
    escolhaOModo: 'Choose a mode',
    semDesfazerSemTuboDicas: (n) => `No undo · No +column · ${n} ${n === 1 ? 'hint' : 'hints'}`,
  },

  wildTutorial: {
    coringa: 'Wild',
    entendi: 'Got it',
    intro: 'This special color matches with any other.',
    podeReceber: 'It can receive any color,',
    e: 'and',
    qualquerCorPode: 'any color can be poured into a tube with a wild.',
  },

  updateReady: {
    tituloDisponivel: 'New update available',
    tituloNovidades: 'Latest update',
    notas: [
      '🍇 New tube color: wine violet!',
      '💀 Extreme mode supercharged — a real challenge in every phase',
      '💡 Smarter hints: there is always a way out',
      '✨ Polished visuals and a more stable game under the hood',
    ],
    depois: 'Later',
    instalarAgora: 'Install now',
    ok: 'OK',
  },

  modes: {
    zen: {
      name: 'Zen',
      tagline: 'Gentle pace, no rush',
      description: 'Calmer levels with fewer colors. Unlimited help, no penalty.',
    },
    balanced: {
      name: 'Balanced',
      tagline: 'Progressive challenge',
      description: 'A mix of easy and hard levels. Special mechanics appear gradually.',
    },
    extreme: {
      name: 'Extreme',
      tagline: "One wrong move and it's over",
      description: 'More colors and early mechanics. No undo, no extra tube. Only 3 hints.',
    },
  },

  boss: {
    engarrafador: {
      name: 'The Bottler',
      title: 'Master of Liquid Chaos',
      lore:
        'An obsessive craftsman who spent decades trying to bottle perfect colors. ' +
        "He never succeeded — and doesn't want you to either. " +
        "Every moment you're not looking, he swaps the contents of two tubes at random.",
      ability: '💧 Deluge · Every 5 moves, two tubes swap their top liquid',
    },
    alquimista: {
      name: 'The Alchemist',
      title: 'Lady of Metamorphoses',
      lore:
        'Master of impossible transformations. ' +
        "Her liquids never sit still; every time you look away, two tubes swap places, " +
        'as if chemistry itself refused to be tamed.',
      ability: '🧪 Double Deluge · Every 4 moves, two tubes swap their top liquid',
    },
    oceano: {
      name: 'The Ocean',
      title: 'Force of Nature',
      lore:
        "It isn't a being — it's a primal force. " +
        "It doesn't tire, doesn't feel, doesn't stop. " +
        'Every three moves brings a new tide that swaps the contents of two tubes.',
      ability: '🌊 Triple Tide · Every 3 moves, two tubes swap their top liquid',
    },
  },

  economy: {
    bg: {
      noite: 'Hills',
      oceano: 'Ocean Floor',
      aurora: 'Aurora',
      lavanda: 'Lavender',
      sunset: 'Sunset',
      carvao: 'Charcoal',
      trilha: 'Jungle Trail',
      vila: 'Blossom Village',
      neve: 'Frozen River',
      deserto: 'Canyon',
      ruinas: 'Temple Ruins',
    },
    tube: {
      cristal: 'Crystal',
      ambar: 'Amber',
      esmeralda: 'Emerald',
      rose: 'Rosé',
      ouro: 'Old Gold',
    },
    shape: {
      classica: 'Classic',
      proveta: 'Test Tube',
      farmacia: 'Apothecary',
      erlenmeyer: 'Erlenmeyer',
      balao: 'Flask',
    },
  },

  levels: {
    facil: 'Easy',
    medio: 'Medium',
    dificil: 'Hard',
    muito: 'Very hard',
  },

  sfx: {
    soft: 'Soft tap',
    wood: 'Wood knock',
    pop: 'Bright pop',
  },

  v2: {
    jogar: 'Play',
    pularTelaVitoria: 'Skip victory screen',
    imersaoTitulo: 'Play fullscreen?',
    imersaoCorpo: 'More room for the tubes. You can exit whenever you want.',
    imersaoJogar: 'Play fullscreen',
    imersaoAgoraNao: 'Not now',
    imersaoIosTitulo: 'Play fullscreen',
    imersaoIosCorpo: 'Tap Share and choose “Add to Home Screen”. The game opens fullscreen from the icon.',
  },
};
