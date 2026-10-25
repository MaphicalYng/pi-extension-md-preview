import React, { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpenText,
  Braces,
  Check,
  CheckCircle2,
  ChevronRight,
  Code2,
  Copy,
  Download,
  FileDown,
  FileText,
  Github,
  Globe2,
  Languages,
  Menu,
  MessageCircleMore,
  Moon,
  MousePointer2,
  Palette,
  PanelLeft,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";
import logoUrl from "./assets/logo.svg?url";
import { getInitialLanguage, LANGUAGE_STORAGE_KEY, translations } from "./i18n.js";

const GITHUB = "https://github.com/MaphicalYng/pi-extension-md-preview";
const INSTALL = "pi install npm:pi-md-preview@0.5.0";

function CopyCommand({ dark = false, compact = false, t }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    await navigator.clipboard.writeText(INSTALL);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      className={`copy-command ${dark ? "copy-command--dark" : ""} ${compact ? "copy-command--compact" : ""}`}
      onClick={copy}
      aria-label={copied ? t.common.installCopied : t.common.copyInstall}
    >
      {!compact && <span className="command-prompt">$</span>}
      <code>{INSTALL}</code>
      <span className="copy-icon">{copied ? <Check size={17} /> : <Copy size={17} />}</span>
      <span className="copy-label">{copied ? t.common.copied : t.common.copy}</span>
    </button>
  );
}

function Header({ lang, onToggleLanguage, t }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const links = [
    ["experience", t.nav.experience],
    ["features", t.nav.features],
    ["workflow", t.nav.workflow],
    ["install", t.nav.install],
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={`site-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="nav-shell">
        <a className="brand" href="#top" aria-label={t.nav.home}>
          <img src={logoUrl} alt="" />
          <span>md-preview</span>
          <span className="brand-tag">FOR PI</span>
        </a>
        <nav className={`main-nav ${open ? "is-open" : ""}`} aria-label={t.nav.label}>
          {links.map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => setOpen(false)}>{label}</a>)}
          <a className="mobile-github" href={GITHUB} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={16} /></a>
        </nav>
        <div className="nav-actions">
          <button className="language-switch" onClick={onToggleLanguage} aria-label={t.nav.language} title={t.nav.language}>
            <Languages size={15} /><span>{lang === "zh" ? "EN" : "中"}</span>
          </button>
          <a className="github-link" href={GITHUB} target="_blank" rel="noreferrer" aria-label={t.nav.github}>
            <Github size={19} />
          </a>
          <a className="button button--small button--ink" href="#install">{t.nav.cta} <ArrowUpRight size={15} /></a>
          <button className="menu-button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={t.nav.menu}>
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
    </header>
  );
}

function ProductPreview({ t }) {
  const [asked, setAsked] = useState(false);
  const tocHrefs = ["experience", "features", "workflow", "install"];

  return (
    <div className="product-stage" aria-label={t.preview.label}>
      <div className="stage-note stage-note--top"><span /> LOCAL PREVIEW <ShieldCheck size={13} /></div>
      <div className="browser-window">
        <div className="browser-bar">
          <div className="window-dots"><i /><i /><i /></div>
          <div className="address-bar"><ShieldCheck size={11} /><span>127.0.0.1:5173/doc/q3-report</span></div>
          <div className="browser-more">•••</div>
        </div>
        <div className="reader-toolbar">
          <div className="reader-file"><FileText size={14} /><strong>{t.preview.file}</strong><span>pi-extension</span></div>
          <div className="reader-actions"><MessageCircleMore size={14} /><PanelLeft size={14} /><Sun size={14} /><Download size={14} /></div>
        </div>
        <div className="reader-body">
          <aside className="reader-toc">
            <span className="toc-label">{t.preview.toc}</span>
            {t.preview.tocItems.map((item, index) => <a key={item} className={index === 0 ? "active" : ""} href={`#${tocHrefs[index]}`}>{item}</a>)}
            <div className="toc-line"><span /></div>
          </aside>
          <article className="reader-document">
            <div className="doc-eyebrow">TECHNICAL REPORT <span>·</span> 8 MIN READ</div>
            <h3>2025 Q3<br />{t.preview.title}</h3>
            <div className="doc-meta"><span className="author-avatar">M</span> MaphicalYng <i /> 2025.10.25</div>
            <hr />
            <h4><span>01</span> {t.preview.summary}</h4>
            <p>{t.preview.paragraphA} <b>87%</b> {t.preview.paragraphB} <mark>31%</mark> {t.preview.paragraphC}</p>
            <button className={`selection-action ${asked ? "is-asked" : ""}`} onClick={() => setAsked(!asked)}>
              <Sparkles size={12} /> {asked ? t.preview.hideAnswer : t.preview.ask}
            </button>
            <div className="doc-table">
              <div className="doc-tr doc-th">{t.preview.metrics.map(item => <span key={item}>{item}</span>)}</div>
              <div className="doc-tr"><span>{t.preview.latency}</span><span>840 ms</span><span>580 ms</span><b>−31%</b></div>
              <div className="doc-tr"><span>{t.preview.errors}</span><span>0.42%</span><span>0.11%</span><b>−74%</b></div>
            </div>
            <div className={`agent-answer ${asked ? "is-visible" : ""}`}>
              <div className="answer-head"><span><Sparkles size={12} /> Agent</span><button onClick={() => setAsked(false)} aria-label={t.preview.closeAnswer}><X size={12} /></button></div>
              <p>{t.preview.answer}</p>
              <div className="answer-foot"><CheckCircle2 size={11} /> {t.preview.justNow}</div>
            </div>
          </article>
        </div>
        <div className="reader-status"><span><i /> {t.preview.live}</span><span>1 / 4</span></div>
      </div>
      <div className="floating-export"><FileDown size={16} /><div><strong>{t.preview.exported}</strong><span>{t.preview.exportDetail}</span></div><Check size={15} /></div>
      <div className="stage-caption"><MousePointer2 size={14} /> {t.preview.caption}</div>
    </div>
  );
}

const interactionTabs = [
  { id: "ask", icon: MessageCircleMore },
  { id: "revise", icon: Braces },
  { id: "chat", icon: Globe2 },
];

function InteractionShowcase({ t }) {
  const [tab, setTab] = useState("ask");
  const [sent, setSent] = useState(false);
  const content = t.interaction.items[tab];

  function changeTab(id) {
    setTab(id);
    setSent(false);
  }

  return (
    <div className="interaction-shell">
      <div className="interaction-tabs" role="tablist" aria-label={t.interaction.tablist}>
        {interactionTabs.map(({ id, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => changeTab(id)}><Icon size={16} />{t.interaction.tabs[id]}</button>
        ))}
      </div>
      <div className="interaction-content">
        <div className="interaction-copy" key={`${tab}-copy`}>
          <span className="section-eyebrow">{content.eyebrow}</span>
          <h3>{content.title}</h3>
          <p>{content.description}</p>
          <a href="#install">{t.interaction.cta} <ArrowRight size={16} /></a>
        </div>
        <div className="conversation-demo" key={tab}>
          <div className="conversation-paper">
            <div className="quote-source"><FileText size={13} /> q3-infrastructure-report.md <span>{t.interaction.section}</span></div>
            <blockquote>{content.quote}</blockquote>
            <div className="question-row"><div className="user-avatar">{t.interaction.user}</div><p>{content.question}</p></div>
            {sent ? (
              <div className="response-row">
                <div className="agent-avatar"><Sparkles size={15} /></div>
                <div><strong>Agent <span>{t.interaction.justNow}</span></strong><p>{content.answer}</p></div>
              </div>
            ) : (
              <button className="send-demo" onClick={() => setSent(true)}><Send size={14} /> {t.interaction.send} <span>↵</span></button>
            )}
          </div>
          <div className="demo-hint"><Zap size={13} /> {sent ? t.interaction.sentHint : t.interaction.idleHint}</div>
        </div>
      </div>
    </div>
  );
}

function ReadingCard({ t }) {
  const [dark, setDark] = useState(false);
  const [large, setLarge] = useState(false);

  return (
    <article className="feature-card feature-card--reading">
      <div className="feature-heading"><span className="feature-icon"><Palette size={19} /></span><div><h3>{t.features.readingTitle}</h3><p>{t.features.readingDescription}</p></div></div>
      <div className={`reading-sample ${dark ? "is-dark" : ""} ${large ? "is-large" : ""}`}>
        <div className="reading-controls">
          <button onClick={() => setDark(!dark)} aria-label={t.features.theme}>{dark ? <Moon size={15} /> : <Sun size={15} />}</button>
          <button onClick={() => setLarge(!large)} aria-label={t.features.fontSize}>A<span>A</span></button>
          <span className="reading-color" />
        </div>
        <div className="reading-sample-content"><span>DESIGN NOTES</span><h4>Less, but better.</h4><p>{t.features.sampleA}<br />{t.features.sampleB}</p><i /><i /><i /></div>
      </div>
      <div className="preference-note"><CheckCircle2 size={13} /> {t.features.preference}</div>
    </article>
  );
}

function Features({ t }) {
  return (
    <div className="feature-grid">
      <ReadingCard t={t} />
      <article className="feature-card feature-card--mermaid">
        <div className="feature-heading"><span className="feature-icon"><Code2 size={19} /></span><div><h3>{t.features.codeTitle}</h3><p>{t.features.codeDescription}</p></div></div>
        <div className="diagram-window">
          <div className="diagram-code"><span>mermaid</span><Copy size={12} /></div>
          <div className="diagram-canvas">
            <div className="diagram-node diagram-node--a"><FileText size={13} /> Markdown</div>
            <div className="diagram-arrow"><span>render</span><ArrowRight size={24} /></div>
            <div className="diagram-node diagram-node--b"><Globe2 size={13} /> Web page</div>
          </div>
        </div>
        <div className="language-list"><span>TypeScript</span><span>Python</span><span>Rust</span><b>25+</b></div>
      </article>
      <article className="feature-card feature-card--sync">
        <div className="sync-orbit"><span className="orbit-center"><RefreshCw size={25} /></span><i className="orbit-dot orbit-dot--one" /><i className="orbit-dot orbit-dot--two" /></div>
        <div className="feature-heading"><span className="feature-icon"><Zap size={19} /></span><div><h3>{t.features.syncTitle}</h3><p>{t.features.syncDescription}</p></div></div>
        <div className="sync-status"><span><i /> LIVE</span><code>document updated · just now</code></div>
      </article>
      <article className="feature-card feature-card--export">
        <div className="feature-heading"><span className="feature-icon"><FileDown size={19} /></span><div><h3>{t.features.exportTitle}</h3><p>{t.features.exportDescription}</p></div></div>
        <div className="export-stack"><div className="export-page export-page--back" /><div className="export-page export-page--mid" /><div className="export-page export-page--front"><FileText size={25} /><span>report.html</span><b>SELF-CONTAINED</b><i>HTML</i></div></div>
      </article>
    </div>
  );
}

function App() {
  const [lang, setLang] = useState(getInitialLanguage);
  const t = translations[lang];
  const trustIcons = [BookOpenText, MessageCircleMore, ShieldCheck, Languages, FileDown];
  const workflowIcons = [FileText, Zap, MessageCircleMore];

  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = t.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", t.meta.description);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  }, [lang, t]);

  return (
    <>
      <Header lang={lang} onToggleLanguage={() => setLang(lang === "zh" ? "en" : "zh")} t={t} />
      <main id="top">
        <section className="hero section-shell">
          <div className="hero-copy">
            <div className="release-pill"><span>NEW</span> {t.hero.release} <ArrowUpRight size={13} /></div>
            <h1>{t.hero.titleA}<br /><em>{t.hero.titleB}</em></h1>
            <p className="hero-description">{t.hero.descriptionA}<br className="desktop-break" /> {t.hero.descriptionB}</p>
            <div className="hero-actions"><CopyCommand t={t} /><a className="text-link" href="#experience">{t.hero.explore} <ArrowRight size={16} /></a></div>
            <div className="hero-proof">{t.hero.proofs.map(item => <span key={item}><Check size={13} /> {item}</span>)}</div>
          </div>
          <ProductPreview t={t} />
        </section>

        <section className="trust-strip" aria-label={t.trust.label}>
          <div className="section-shell trust-inner">
            <span>{t.trust.lead}</span><i />
            {t.trust.items.map((item, index) => { const Icon = trustIcons[index]; return <div key={item}><Icon size={16} /> {item}</div>; })}
          </div>
        </section>

        <section className="experience section-shell section-space" id="experience">
          <div className="section-heading section-heading--split">
            <div><span className="section-number">{t.experience.number}</span><h2>{t.experience.titleA}<br />{t.experience.titleB}</h2></div>
            <p>{t.experience.descriptionA}<br />{t.experience.descriptionB}</p>
          </div>
          <InteractionShowcase t={t} />
        </section>

        <section className="features-section section-space" id="features">
          <div className="section-shell">
            <div className="section-heading section-heading--split">
              <div><span className="section-number">{t.featureSection.number}</span><h2>{t.featureSection.titleA}<br />{t.featureSection.titleB}</h2></div>
              <p>{t.featureSection.descriptionA}<br />{t.featureSection.descriptionB}</p>
            </div>
            <Features t={t} />
          </div>
        </section>

        <section className="workflow section-shell section-space" id="workflow">
          <div className="section-heading section-heading--center"><span className="section-number">{t.workflow.number}</span><h2>{t.workflow.title}</h2><p>{t.workflow.description}</p></div>
          <div className="workflow-grid">
            <div className="workflow-steps">
              {t.workflow.steps.map((step, index) => { const Icon = workflowIcons[index]; return <article key={step.title}><span>0{index + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p></div><Icon size={20} /></article>; })}
            </div>
            <div className="terminal-card">
              <div className="terminal-head"><div className="window-dots"><i /><i /><i /></div><span>pi — zsh</span><span>⌘ K</span></div>
              <div className="terminal-body">
                <p><span className="terminal-muted">╭─</span> <span className="terminal-blue">user</span></p>
                <p>{t.workflow.request}</p>
                <p><span className="terminal-muted">╰─</span></p>
                <br />
                <p><span className="terminal-orange">●</span> <span className="terminal-blue">Agent</span></p>
                <p>{t.workflow.response}</p>
                <div className="tool-call"><div><ChevronRight size={13} /><span>md_preview</span><b>completed</b></div><code>file: ./reports/q3-report.md</code><code>ui_lang: &quot;{lang}&quot;</code></div>
                <p className="terminal-result"><CheckCircle2 size={13} /> Preview opened in your browser</p>
                <span className="terminal-cursor" />
              </div>
            </div>
          </div>
        </section>

        <section className="install-section section-shell" id="install">
          <div className="install-card">
            <div className="install-grid-pattern" />
            <div className="install-copy"><span className="section-eyebrow">{t.install.eyebrow}</span><h2>{t.install.titleA}<br />{t.install.titleB}</h2><p>{t.install.descriptionA}<br />{t.install.descriptionB}</p><div className="install-links"><a href={GITHUB} target="_blank" rel="noreferrer"><Github size={17} /> {t.install.github} <ArrowUpRight size={15} /></a><a href={`https://github.com/MaphicalYng/pi-extension-md-preview/blob/main/${lang === "zh" ? "README.zh-CN.md" : "README.md"}`} target="_blank" rel="noreferrer">{t.install.docs} <ArrowRight size={15} /></a></div></div>
            <div className="install-action"><span>{t.install.terminal}</span><CopyCommand dark t={t} /><p><Check size={13} /> {t.install.trial}</p><code className="trial-command trial-command--block">pi -e npm:pi-md-preview</code><span className="install-omp">{t.install.ompTerminal}</span><code className="trial-command trial-command--block">omp install npm:pi-md-preview@0.5.0</code><p><Check size={13} /> {t.install.ompTrial}</p><code className="trial-command trial-command--block">omp -e ./pi-extension-md-preview</code></div>
          </div>
        </section>
      </main>
      <footer className="site-footer section-shell">
        <a className="brand" href="#top"><img src={logoUrl} alt="" /><span>md-preview</span></a>
        <p>{t.footer.tagline}</p>
        <div><span>MIT License</span><a href={GITHUB} target="_blank" rel="noreferrer">GitHub <ArrowUpRight size={13} /></a><a href="#top">{t.footer.top}</a></div>
      </footer>
    </>
  );
}

export default App;
