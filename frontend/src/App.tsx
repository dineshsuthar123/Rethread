import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  Check,
  Plus,
  Search,
  X,
  Sun,
  Moon,
  GitBranch,
  Terminal,
  ShieldCheck,
  ArrowLeft,
  Download,
  RotateCcw,
  Command,
  ExternalLink,
} from "lucide-react";
import type { Case, CaseEvent, Repository, Session } from "@rethread/contracts";
import { terminal } from "@rethread/contracts";
import { api, ApiError, mutate, session, watchCase } from "./api";
import { fixture } from "./fixture";
import { Brand, Intro, Mark, Sculpture } from "./Identity";

const iconProps = { size: 16, strokeWidth: 1.6 };
const Arrow = () => <ArrowUpRight {...iconProps} />;
const Label = ({ children }: { children: ReactNode }) => (
  <span className="eyebrow mono">{children}</span>
);
function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <Mark />
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
const statusLabel = (s: string) => s.replaceAll("_", " ");

export function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const work = location.pathname.startsWith("/studio");
  const [identity, setIdentity] = useState<Session>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("rethread:theme") || "dark",
  );
  const [motion, setMotion] = useState(
    () =>
      !matchMedia("(prefers-reduced-motion: reduce)").matches &&
      localStorage.getItem("rethread:motion") !== "off",
  );
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Case[]>([]);
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  useEffect(() => {
    void session()
      .then(setIdentity)
      .catch(() => setIdentity(null))
      .finally(() => setAuthLoading(false));
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = work ? theme : "light";
    document.documentElement.dataset.motion = motion ? "on" : "off";
    localStorage.setItem("rethread:theme", theme);
    localStorage.setItem("rethread:motion", motion ? "on" : "off");
  }, [theme, motion, work]);
  useEffect(() => {
    const titles: Record<string, string> = {
      "/": "Fix the failure. Keep the lesson.",
      "/how-it-works": "How it works",
      "/docs": "Documentation",
      "/login": "Sign in",
      "/connect": "Connect a repository",
      "/studio": "Cases",
      "/studio/guards": "Guards",
      "/studio/settings": "Settings",
    };
    document.title = `${titles[location.pathname] || "Case replay"} · Rethread`;
    setMenu(false);
    if (first.current) {
      first.current = false;
      return;
    }
    main.current?.focus({ preventScroll: true });
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    } else window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    const keyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === "Escape") {
        setMenu(false);
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    if (!searchOpen || !identity) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void api<{ cases: Case[] }>(
        `/cases?search=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((r) => setFound(r.cases))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchOpen, identity]);
  function changeSearch(id: string) {
    setSearchOpen(false);
    navigate(`/studio/cases/${id}`);
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className={`topbar ${work ? "work-topbar" : ""}`}>
        <Brand />
        <nav aria-label="Main navigation">
          {work ? (
            <>
              <NavLink to="/studio" end>
                Cases
              </NavLink>
              <NavLink to="/studio/cases/example">Replay</NavLink>
              <NavLink to="/studio/guards">Guards</NavLink>
              <NavLink to="/studio/settings">Settings</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/how-it-works">The method</NavLink>
              <NavLink to="/docs">Field notes</NavLink>
            </>
          )}
        </nav>
        <div className="nav-actions">
          {work && (
            <button
              className="icon-button"
              aria-label="Search Cases (Control K)"
              onClick={() => setSearchOpen(true)}
            >
              <Search {...iconProps} />
            </button>
          )}
          <button
            className="chapter-button"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            Chapters <ChevronDown {...iconProps} />
          </button>
          {!work && (
            <Link to={identity ? "/studio" : "/login"} className="nav-studio">
              Open Studio <Arrow />
            </Link>
          )}
          {work && (
            <button
              className="icon-button"
              aria-label={`Use ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            >
              {theme === "dark" ? (
                <Sun {...iconProps} />
              ) : (
                <Moon {...iconProps} />
              )}
            </button>
          )}
        </div>
        {menu && (
          <div className="chapter-menu">
            <Label>Follow the thread</Label>
            {[
              ["/", "The idea"],
              ["/how-it-works", "Failure → Repair → Guard"],
              ["/studio/cases/example", "Interactive example"],
              ["/docs", "Documentation"],
              ["/connect", "Connect a repository"],
            ].map(([href, title]) => (
              <Link key={href} to={href}>
                {title}
                <Arrow />
              </Link>
            ))}
          </div>
        )}
      </header>
      <div
        key={location.pathname}
        className={`route-seam ${work ? "short" : ""}`}
        aria-hidden="true"
      />
      <main id="main" ref={main} tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Marketing motion={motion} />} />
          <Route path="/how-it-works" element={<Method />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/login" element={<Login identity={identity} />} />
          <Route
            path="/connect"
            element={<Connect identity={identity} loading={authLoading} />}
          />
          <Route
            path="/studio"
            element={<CaseList identity={identity} loading={authLoading} />}
          />
          <Route
            path="/studio/repos/:repoId"
            element={<CaseList identity={identity} loading={authLoading} />}
          />
          <Route
            path="/studio/cases/:caseId"
            element={<CasePage identity={identity} loading={authLoading} />}
          />
          <Route
            path="/studio/guards"
            element={<Guards identity={identity} loading={authLoading} />}
          />
          <Route
            path="/studio/settings"
            element={
              <Settings
                identity={identity}
                theme={theme}
                setTheme={setTheme}
                motion={motion}
                setMotion={setMotion}
                logout={async () => {
                  if (identity) await mutate("/logout", identity.csrf);
                  setIdentity(null);
                  navigate("/login");
                }}
              />
            }
          />
          <Route
            path="*"
            element={
              <Empty
                title="This thread ends here."
                action={
                  <Link className="button" to="/">
                    Return home <Arrow />
                  </Link>
                }
              >
                That page could not be found.
              </Empty>
            }
          />
        </Routes>
      </main>
      {!work && (
        <footer className="footer">
          <Brand />
          <span>Fix the failure. Keep the lesson.</span>
          <Link to="/docs#limits">
            Scope & limitations <Arrow />
          </Link>
          <small>Independent project · built in the open.</small>
        </footer>
      )}
      {location.pathname === "/" && <Intro enabled={motion} />}{" "}
      {searchOpen && (
        <dialog open className="command-dialog" aria-label="Search Cases">
          <div>
            <Search {...iconProps} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Case titles and behavior contracts"
              aria-label="Search Cases"
            />
            <button
              className="icon-button"
              aria-label="Close search"
              onClick={() => setSearchOpen(false)}
            >
              <X {...iconProps} />
            </button>
          </div>
          {identity ? (
            found.length ? (
              found.map((c) => (
                <button key={c.id} onClick={() => changeSearch(c.id)}>
                  {c.title}
                  <span>{statusLabel(c.state)}</span>
                </button>
              ))
            ) : (
              <p>No matching Cases.</p>
            )
          ) : (
            <p>
              <Link to="/login" onClick={() => setSearchOpen(false)}>
                Sign in
              </Link>{" "}
              to search your repository memory.
            </p>
          )}
          <small>Ctrl / ⌘ K to open · Esc to close</small>
        </dialog>
      )}
    </>
  );
}

function Marketing({ motion }: { motion: boolean }) {
  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <Label>Software that remembers its failures</Label>
          <h1>
            Fix the failure.
            <br />
            Keep the{" "}
            <span className="lesson">
              lesson.
              <svg viewBox="0 0 360 18" aria-hidden="true">
                <path d="M0 12C85 12 130 2 212 7S320 15 360 4" />
              </svg>
            </span>
          </h1>
          <p>
            A broken build is a starting point.
            <br />
            Replay it. Review a focused repair. Carry the behavior forward with
            a regression guard.
          </p>
          <div className="hero-actions">
            <Link className="button" to="/connect">
              Connect repository <Arrow />
            </Link>
            <Link className="text-link" to="/studio/cases/example">
              Try an interactive case <ArrowRight {...iconProps} />
            </Link>
          </div>
          <div className="hero-foot mono">
            <span>
              <i />
              PYTHON FIRST
            </span>
            <span>PYTEST + RUFF</span>
            <span>YOUR APPROVAL. YOUR REPOSITORY.</span>
          </div>
        </div>
        <Sculpture motion={motion} />
        <div className="hero-bottom">
          <span className="mono">
            01 — A FAILURE RETURNS AS A LASTING GUARD
          </span>
          <Link
            to="/#replay"
            onClick={() =>
              setTimeout(
                () =>
                  document
                    .getElementById("replay")
                    ?.scrollIntoView({ behavior: motion ? "smooth" : "auto" }),
                0,
              )
            }
          >
            Trace the thread <span>↓</span>
          </Link>
        </div>
      </section>
      <section className="replay-section" id="replay">
        <div className="section-heading">
          <div>
            <Label>The useful unit is a Case</Label>
            <h2>
              Less starting over.
              <br />
              More carrying forward.
            </h2>
          </div>
          <p>
            Keep the snapshot, the failure, the repair,
            <br />
            and the reason it must stay fixed.
            <br />
            <Link className="text-link" to="/how-it-works">
              Inside the method <Arrow />
            </Link>
          </p>
        </div>
        <Example compact />
      </section>
      <section className="memory-section">
        <div className="memory-number mono">03 / REMEMBER</div>
        <div>
          <h2>
            Next change.
            <br />
            Same promise.
          </h2>
          <p>
            A later pull request touches the repaired behavior. Rethread reruns
            the retained guard and links any recurrence to the original Case.
          </p>
          <Link to="/studio/cases/example" className="text-link">
            Introduce the regression <Arrow />
          </Link>
        </div>
        <div className="memory-evidence mono">
          <span>
            <GitBranch {...iconProps} /> future pull request
          </span>
          <div className="memory-line" />
          <span>
            <ShieldCheck {...iconProps} /> recorded guard
          </span>
          <div className="memory-line ember" />
          <strong>Duplicate delivery detected.</strong>
          <small>Example scenario · original Case attached</small>
        </div>
      </section>
      <section className="connect-section">
        <Label>Keep a thread worth following</Label>
        <h2>
          Your next fix can
          <br />
          leave something behind.
        </h2>
        <Link className="button" to="/connect">
          Connect your repository <Arrow />
        </Link>
        <p>
          Python · pytest · Ruff. Clear evidence. Draft pull requests.
          <br />
          An executable reproduction is required.
        </p>
      </section>
    </>
  );
}

function Method() {
  return (
    <article className="editorial">
      <Label>Field note 001 / the method</Label>
      <h1>
        A repair with
        <br />a memory.
      </h1>
      <p className="lead">
        A chat disappears into history. A Case carries the behavior into the
        next change.
      </p>
      {[
        [
          "01",
          "Capture the failure",
          "Pin an immutable commit. Store the executable reproduction, its output, the tool versions and the dependency recipe. Reproduce before changing anything.",
        ],
        [
          "02",
          "Repair with evidence",
          "Propose a bounded source patch. Run the original reproduction and the unchanged pytest and Ruff inventory against the candidate. Every result remains independently inspectable.",
        ],
        [
          "03",
          "Keep the lesson",
          "For a behavior repair, add a guard that fails on the captured base and passes on the candidate. The behavior contract states what must remain true.",
        ],
        [
          "04",
          "Review, then publish",
          "Approve the exact proposal before creating a draft PR. A changed repository head invalidates old publication evidence. Future PR updates rerun the complete retained guard suite.",
        ],
      ].map(([n, title, copy]) => (
        <section className="method-row" key={n}>
          <span className="mono">{n}</span>
          <div>
            <h2>{title}</h2>
            <p>{copy}</p>
          </div>
        </section>
      ))}
      <Link className="button" to="/studio/cases/example">
        Explore the example <Arrow />
      </Link>
    </article>
  );
}
function Docs() {
  return (
    <article className="editorial docs">
      <Label>The Rethread field guide</Label>
      <h1>
        Evidence you
        <br />
        can take with you.
      </h1>
      <p className="lead">
        Start with an executable failure. End with a reviewable repair and a
        guard you can run without the hosted app.
      </p>
      <section id="start">
        <h2>Connect & capture</h2>
        <p>
          Sign in through GitHub, install the Rethread GitHub App on a
          repository you can access, and choose its branch and immutable commit.
          Select a failed Actions run for context, then supply the exact pytest
          test identity or a Ruff reproduction.
        </p>
        <p>
          Behavior repairs also need your intended behavior contract. An issue
          description or failed run alone becomes <code>needs_input</code>.
        </p>
        <Link className="text-link" to="/connect">
          Connect a repository <Arrow />
        </Link>
      </section>
      <section>
        <h2>Prepare a Python repository</h2>
        <p>
          The first adapter supports Python with pytest and Ruff. Commit{" "}
          <code>requirements.lock</code> with exact dependency versions and
          SHA256 hashes. For a standard-library-only project, an empty lock is
          valid. Tests run inside disposable E2B sandboxes with network denied
          after dependency installation.
        </p>
        <pre>
          <code>
            python -m pip install --require-hashes --no-deps -r
            requirements.lock{"\n"}python -m pytest -q
            tests/test_delivery.py::test_retry_delivery{"\n"}python -m pytest -q
            {"\n"}python -m ruff check .
          </code>
        </pre>
        <p>
          Rethread never runs target repository code on its API or worker host.
          If the sandbox is unavailable, the Case is blocked.
        </p>
      </section>
      <section>
        <h2>Review the three-part Case</h2>
        <p>
          <strong>Failure</strong> contains the pinned snapshot and
          reproduction. <strong>Repair</strong> shows the exact diff and each
          candidate check. <strong>Guard</strong> records the contract, additive
          test, base failure and candidate pass. Approve the exact verified
          proposal, then separately publish a draft pull request.
        </p>
      </section>
      <section>
        <h2>Carry the evidence home</h2>
        <p>
          Export the versioned Case manifest from the evidence dock. The repair
          PR adds <code>.rethread/cases/&lt;case-id&gt;/manifest.json</code>,
          reproduction instructions and an additive guard under{" "}
          <code>tests/guards/</code>. Secrets and source archives are excluded.
        </p>
      </section>
      <section id="limits">
        <h2>Honest limits</h2>
        <p>
          Verification is scoped to the recorded snapshot, dependency recipe,
          reproduction, suite and guard. It does not prove all behavior is
          correct. JavaScript, TypeScript, Java and Go repair adapters are not
          supported in this release. Unpinned dependencies, zero collected
          tests, invalid reports and unavailable tools never count as a pass.
        </p>
        <p>
          A removed or changed guard needs review. Changed-path relationships
          explain which guards run first; the complete retained suite runs
          before an all-guards-pass result.
        </p>
      </section>
      <section>
        <h2>Privacy & control</h2>
        <p>
          Repository access uses scoped GitHub App tokens. Hosted Cases require
          your session and workspace membership. You can cancel active work,
          reject a proposal, archive a Case, export its evidence and revoke
          access through GitHub. Logs and artifacts have a 30-day retention
          period.
        </p>
      </section>
      <Link className="button" to="/studio/cases/example">
        Try a labeled example <Arrow />
      </Link>
    </article>
  );
}
function Login({ identity }: { identity: Session }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    void api<{ loginConfigured: boolean }>("/capabilities")
      .then((c) => setConfigured(c.loginConfigured))
      .catch(() => setConfigured(false));
  }, []);
  return (
    <section className="auth-page">
      <Label>Return to your work</Label>
      <h1>
        A place for the
        <br />
        fixes that matter.
      </h1>
      <p>
        Use your GitHub identity to connect an authorized repository and keep
        its repair history in one workspace.
      </p>
      {identity ? (
        <Link className="button" to="/studio">
          Open your Studio <Arrow />
        </Link>
      ) : configured ? (
        <a className="button" href="/api/auth/github">
          Continue with GitHub <Arrow />
        </a>
      ) : (
        <Notice>
          {configured === null
            ? "Checking GitHub connection…"
            : "GitHub sign-in is not configured on this deployment yet."}
          <br />
          <Link to="/docs">Read the connection guide</Link>
        </Notice>
      )}
      <Link className="text-link" to="/studio/cases/example">
        Explore the example without signing in <ArrowRight {...iconProps} />
      </Link>
    </section>
  );
}
function AuthGate({
  identity,
  loading,
  children,
}: {
  identity: Session;
  loading: boolean;
  children: ReactNode;
}) {
  return loading ? (
    <Empty title="Opening your workspace…">Checking your session.</Empty>
  ) : !identity ? (
    <Empty
      title="Bring your repository along."
      action={
        <Link className="button" to="/login">
          Sign in with GitHub <Arrow />
        </Link>
      }
    >
      Sign in to access your Cases, guards and repository connections. You can
      also <Link to="/studio/cases/example">explore the example</Link>.
    </Empty>
  ) : (
    <>{children}</>
  );
}

function Connect({
  identity,
  loading,
}: {
  identity: Session;
  loading: boolean;
}) {
  const [installations, setInstallations] = useState<
    { id: number; account: string }[]
  >([]);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [installation, setInstallation] = useState("");
  const [repos, setRepos] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    if (!identity) return;
    void api<any>("/installations")
      .then((r) => {
        setInstallations(r.installations);
        setInstallUrl(r.installUrl);
        if (r.installations[0]) setInstallation(String(r.installations[0].id));
      })
      .catch((e) => setError(e.message));
  }, [identity]);
  useEffect(() => {
    if (!installation) return;
    void api<any>(`/installations/${installation}/repositories`)
      .then((r) => setRepos(r.repositories))
      .catch((e) => setError(e.message));
  }, [installation]);
  async function connect(r: any) {
    if (!identity) return;
    setBusy(true);
    setError("");
    try {
      const result = await mutate<Repository>("/repositories", identity.csrf, {
        installationId: Number(installation),
        githubId: r.githubId,
        url: r.url,
      });
      navigate(`/studio/repos/${result.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthGate identity={identity} loading={loading}>
      <section className="connection-page">
        <Label>01 / connect</Label>
        <h1>Pick up the thread.</h1>
        <p>
          Choose a repository authorized through your GitHub App installation.
        </p>
        {error && (
          <Notice error>
            {error}
            <button onClick={() => window.location.reload()}>
              Retry connection
            </button>
          </Notice>
        )}
        <div className="connection-install">
          <h2>GitHub App installation</h2>
          {installations.length ? (
            <label>
              Account
              <select
                value={installation}
                onChange={(e) => setInstallation(e.target.value)}
              >
                {installations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.account}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No authorized installation found.</p>
          )}
          {installUrl ? (
            <a className="button secondary" href={installUrl}>
              Install / manage GitHub App <Arrow />
            </a>
          ) : (
            <Notice>The GitHub App is not configured yet.</Notice>
          )}
        </div>
        <div className="repo-list">
          {repos.map((r) => (
            <button
              disabled={busy}
              key={r.githubId}
              onClick={() => void connect(r)}
            >
              <GitBranch {...iconProps} />
              <span>
                {r.fullName}
                <small>{r.defaultBranch}</small>
              </span>
              <Arrow />
            </button>
          ))}
        </div>
      </section>
    </AuthGate>
  );
}

function Ribbon({
  cases,
  repository,
  selected,
}: {
  cases: Case[];
  repository?: Repository;
  selected?: string;
}) {
  return (
    <div className="case-ribbon">
      <Link
        className="ribbon-repo mono"
        to={repository ? `/studio/repos/${repository.id}` : "/studio"}
      >
        <GitBranch {...iconProps} />
        {repository?.full_name || "Your workspace"}
      </Link>
      <div>
        {cases.slice(0, 8).map((c) => (
          <Link
            key={c.id}
            to={`/studio/cases/${c.id}`}
            className={selected === c.id ? "selected" : ""}
          >
            <i className={c.state === "ready_for_review" ? "success" : ""} />
            {c.title}
          </Link>
        ))}
      </div>
      <Link
        className="ribbon-new"
        to={repository ? `/studio/repos/${repository.id}?new=1` : "/connect"}
      >
        <Plus {...iconProps} /> New Case
      </Link>
    </div>
  );
}
function CaseList({
  identity,
  loading,
}: {
  identity: Session;
  loading: boolean;
}) {
  const { repoId } = useParams();
  const [cases, setCases] = useState<Case[]>([]);
  const [repos, setRepos] = useState<Repository[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const location = useLocation();
  useEffect(() => {
    if (!identity) return;
    const controller = new AbortController();
    void Promise.all([
      api<{ cases: Case[] }>(
        `/cases${repoId ? `?repositoryId=${repoId}` : ""}`,
        { signal: controller.signal },
      ),
      api<{ repositories: Repository[] }>("/repositories", {
        signal: controller.signal,
      }),
    ])
      .then(([c, r]) => {
        setCases(c.cases);
        setRepos(r.repositories);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [identity, repoId, location.key]);
  const repo = repos.find((r) => r.id === repoId);
  const shown = cases.filter(
    (c) =>
      !c.archived &&
      c.title.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" ||
        (filter === "active" && !terminal.has(c.state)) ||
        (filter === "review" && c.state === "ready_for_review")),
  );
  return (
    <AuthGate identity={identity} loading={loading}>
      <Ribbon cases={cases} repository={repo} />
      <section className="workspace">
        <div className="workspace-heading">
          <div>
            <Label>Repository memory</Label>
            <h1>Threads worth keeping.</h1>
          </div>
          <Link className="button" to="/connect">
            Connect repository <Plus {...iconProps} />
          </Link>
        </div>
        {error && <Notice error>{error}</Notice>}
        <div className="case-toolbar">
          <label>
            <Search {...iconProps} />
            <input
              placeholder="Search Cases"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search Cases"
            />
          </label>
          <select
            aria-label="Filter Cases"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All current Cases</option>
            <option value="active">Active</option>
            <option value="review">Ready for review</option>
          </select>
          <select
            aria-label="Select repository"
            value={repoId || ""}
            onChange={(e) => {
              window.location.href = e.target.value
                ? `/studio/repos/${e.target.value}`
                : "/studio";
            }}
          >
            <option value="">All repositories</option>
            {repos.map((r) => (
              <option value={r.id} key={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        </div>
        {repo && <NewCase identity={identity!} repository={repo} />}
        <div className="case-list">
          {shown.map((c) => (
            <Link key={c.id} to={`/studio/cases/${c.id}`}>
              <span className="mono">{c.id.slice(0, 8)}</span>
              <div>
                <h2>{c.title}</h2>
                <p>{c.data.request.behaviorContract || "Lint reproduction"}</p>
              </div>
              <span
                className={`state-chip ${c.state === "ready_for_review" ? "success" : ""}`}
              >
                {statusLabel(c.state)}
              </span>
              <Arrow />
            </Link>
          ))}
        </div>
        {!shown.length && (
          <Empty title={repo ? "Start with the failure." : "No Cases yet."}>
            {repo
              ? "Capture an immutable commit and an executable reproduction above."
              : "Connect a repository to capture its first Case."}
          </Empty>
        )}
      </section>
    </AuthGate>
  );
}
function NewCase({
  identity,
  repository,
}: {
  identity: NonNullable<Session>;
  repository: Repository;
}) {
  const [open, setOpen] = useState(
    new URLSearchParams(location.search).has("new"),
  );
  const [branches, setBranches] = useState<{ name: string; sha: string }[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [branch, setBranch] = useState("");
  const [sha, setSha] = useState("");
  const [title, setTitle] = useState("");
  const [contract, setContract] = useState("");
  const [test, setTest] = useState("");
  const [kind, setKind] = useState("pytest");
  const [run, setRun] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const attempt = useRef(crypto.randomUUID());
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    void Promise.all([
      api<any>(`/repositories/${repository.id}/branches`),
      api<any>(`/repositories/${repository.id}/runs`),
    ])
      .then(([b, r]) => {
        setBranches(b.branches);
        setRuns(r.runs);
        const selected =
          b.branches.find((v: any) => v.name === repository.default_branch) ||
          b.branches[0];
        if (selected) {
          setBranch(selected.name);
          setSha(selected.sha);
        }
      })
      .catch((e) => setError(e.message));
  }, [open, repository.id]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const c = await mutate<Case>(
        "/cases",
        identity.csrf,
        {
          repositoryId: repository.id,
          branch,
          baseSha: sha,
          title,
          behaviorContract: contract,
          reproduction:
            test || kind === "ruff"
              ? { kind, test: kind === "ruff" ? "" : test }
              : undefined,
          ...(run ? { actionsRunId: Number(run) } : {}),
        },
        attempt.current,
      );
      navigate(`/studio/cases/${c.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="new-case">
      <button
        className="new-case-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Plus {...iconProps} /> Capture a failure <ChevronDown {...iconProps} />
      </button>
      {open && (
        <form onSubmit={(e) => void submit(e)}>
          {error && <Notice error>{error}</Notice>}
          <label>
            Case title
            <input
              required
              minLength={4}
              maxLength={180}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="A retry should never send twice"
            />
          </label>
          <div className="form-row">
            <label>
              Branch
              <select
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setSha(
                    branches.find((b) => b.name === e.target.value)?.sha || "",
                  );
                  setRun("");
                }}
              >
                {branches.map((b) => (
                  <option key={b.name}>{b.name}</option>
                ))}
              </select>
            </label>
            <label>
              Immutable commit
              <input
                required
                pattern="[a-f0-9]{40}"
                value={sha}
                onChange={(e) => setSha(e.target.value)}
                className="mono"
              />
            </label>
          </div>
          <label>
            Failed Actions run (optional)
            <select
              value={run}
              onChange={(e) => {
                setRun(e.target.value);
                const r = runs.find((r) => String(r.id) === e.target.value);
                if (r) {
                  setSha(r.sha);
                  setBranch(r.branch);
                }
              }}
            >
              <option value="">Manual reproduction</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.sha.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
          <div className="form-row">
            <label>
              Reproduction
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="pytest">pytest behavior test</option>
                <option value="ruff">Ruff lint check</option>
              </select>
            </label>
            {kind === "pytest" && (
              <label>
                Existing test identity
                <input
                  value={test}
                  onChange={(e) => setTest(e.target.value)}
                  placeholder="tests/test_delivery.py::test_retry"
                />
              </label>
            )}
          </div>
          {kind === "pytest" && (
            <label>
              What must remain true?
              <textarea
                value={contract}
                onChange={(e) => setContract(e.target.value)}
                placeholder="Delivering the same event twice queues exactly one notification."
              />
            </label>
          )}
          <p className="form-note">
            No executable oracle? The Case will identify the missing input.
            Pinned requirements.lock is required for replay.
          </p>
          <button className="button" disabled={busy || !repository.connected}>
            {busy ? "Capturing…" : "Capture Case"}
            <Arrow />
          </button>
        </form>
      )}
    </div>
  );
}

function Example({ compact = false }: { compact?: boolean }) {
  const [step, setStep] = useState(0);
  const [regression, setRegression] = useState(false);
  return (
    <div className={`example ${compact ? "compact" : ""}`}>
      <div className="example-heading">
        <span className="example-label mono">
          INTERACTIVE EXAMPLE · NO REPOSITORY CONNECTED
        </span>
        <span className="mono">SQLITE / WEBHOOK DELIVERY</span>
      </div>
      <div className="example-title">
        <h3>{fixture.title}</h3>
        <span
          className={`state-chip ${step >= 2 && !regression ? "success" : ""}`}
        >
          {regression
            ? "Recurrence detected"
            : step === 0
              ? "Captured failure"
              : step === 1
                ? "Candidate repair"
                : "Guard retained"}
        </span>
      </div>
      <ReplayStage
        value={fixture}
        example
        step={step}
        regression={regression}
      />
      <div className="example-controls">
        <div>
          {["Failure", "Repair", "Guard"].map((name, index) => (
            <button
              className={step === index ? "active" : ""}
              key={name}
              onClick={() => {
                setStep(index);
                setRegression(false);
              }}
            >
              <span className="mono">0{index + 1}</span>
              {name}
            </button>
          ))}
        </div>
        {step < 2 ? (
          <button className="text-link" onClick={() => setStep((s) => s + 1)}>
            Follow the thread <ArrowRight {...iconProps} />
          </button>
        ) : (
          <button
            className="text-link"
            onClick={() => setRegression((r) => !r)}
          >
            {regression ? "Restore the repair" : "Introduce a later regression"}
            <RotateCcw {...iconProps} />
          </button>
        )}
      </div>
      <p className="example-limit">
        Deterministic illustration. Hosted verification is scoped to actual
        recorded commands and snapshots.
      </p>
    </div>
  );
}
function ReplayStage({
  value,
  example = false,
  step = 2,
  regression = false,
  onCheck,
}: {
  value: Case;
  example?: boolean;
  step?: number;
  regression?: boolean;
  onCheck?: (check: any) => void;
}) {
  const [tab, setTab] = useState("Failure");
  const proposal = value.data.proposal;
  const checks = value.data.checks || [];
  return (
    <>
      <div className="stage-tabs" role="tablist" aria-label="Case stages">
        {["Failure", "Repair", "Guard"].map((name) => (
          <button
            key={name}
            role="tab"
            aria-selected={tab === name}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="replay-stage">
        <section
          className={`stage failure ${tab === "Failure" ? "mobile-visible" : ""}`}
        >
          <div className="stage-label mono">
            <span>01 / FAILURE</span>
            <Terminal {...iconProps} />
          </div>
          <h3>
            {example
              ? "One event. Two notifications."
              : "The captured behavior."}
          </h3>
          <span className="source-label mono">
            {example ? "delivery.py:18" : value.base_sha.slice(0, 12)}
          </span>
          <pre>
            <code>
              {example
                ? "def deliver(db, event_id):\n    enqueue_notification(event_id)\n    remember(event_id)\n\n# same input, delivered twice"
                : value.data.request.reproduction
                  ? `${value.data.request.reproduction.kind} ${value.data.request.reproduction.test || "check ."}`
                  : "No executable reproduction supplied."}
            </code>
          </pre>
          <div className="check-outcome failure-outcome mono">
            {example
              ? "× EXPECTED 1 · OBSERVED 2"
              : checks.filter((c) => c.phase === "base").length
                ? `${checks.filter((c) => c.phase === "base" && !c.passed).length} recorded failing checks`
                : "Awaiting baseline evidence"}
          </div>
          <p>
            {value.data.request.behaviorContract ||
              "The recorded lint rule must pass."}
          </p>
          <CheckLinks
            checks={checks.filter((c) => c.phase === "base")}
            onCheck={onCheck}
          />
        </section>
        <section
          className={`stage repair ${tab === "Repair" ? "mobile-visible" : ""} ${example && step < 1 ? "pending" : ""}`}
        >
          <div className="stage-label mono">
            <span>02 / REPAIR</span>
            <GitBranch {...iconProps} />
          </div>
          <h3>
            {example
              ? "Claim + enqueue. One transaction."
              : proposal
                ? "A focused candidate."
                : "Waiting for a proposal."}
          </h3>
          <span className="source-label mono">
            {proposal?.files.map((f) => f.path).join(" · ") ||
              "Evidence before edits"}
          </span>
          <pre className="diff">
            <code>
              {proposal?.diff.split("\n").map((line, i) => (
                <span
                  className={
                    line.startsWith("+")
                      ? "added"
                      : line.startsWith("-")
                        ? "removed"
                        : ""
                  }
                  key={i}
                >
                  {line || " "}
                  <br />
                </span>
              )) ||
                "The patch appears after the original failure is reproduced."}
            </code>
          </pre>
          <p>
            {proposal?.rationale ||
              "A source patch will be tied to the observed reproduction."}
          </p>
          <CheckLinks
            checks={checks.filter((c) => c.phase === "candidate")}
            onCheck={onCheck}
          />
        </section>
        <section
          className={`stage guard ${tab === "Guard" ? "mobile-visible" : ""} ${example && step < 2 ? "pending" : ""}`}
        >
          <div className="stage-label mono">
            <span>03 / GUARD</span>
            <ShieldCheck {...iconProps} />
          </div>
          <h3>
            {regression
              ? "The lesson catches a recurrence."
              : proposal?.guard
                ? "Keep this behavior true."
                : "A check that carries forward."}
          </h3>
          <p className="behavior-contract">
            {proposal?.guard?.contract ||
              value.data.request.behaviorContract ||
              "The original Ruff rule remains enabled."}
          </p>
          {proposal?.guard && (
            <pre>
              <code>{proposal.guard.content}</code>
            </pre>
          )}
          <div
            className={`check-outcome mono ${regression ? "failure-outcome" : ""}`}
          >
            {example
              ? step >= 2
                ? regression
                  ? "× LATER PR: GUARD FAILED"
                  : "✓ FAILS ON BASE · PASSES ON REPAIR"
                : "Guard evidence follows verification"
              : checks.some((c) => c.phase === "guard_candidate" && c.passed)
                ? "✓ GUARD VERIFIED AT CAPTURED SNAPSHOT"
                : "Awaiting guard verification"}
          </div>
          <span className="source-label mono">
            {proposal?.guard?.path || "Retained lint rule"}
          </span>
          <CheckLinks
            checks={checks.filter((c) => c.phase.startsWith("guard"))}
            onCheck={onCheck}
          />
        </section>
      </div>
    </>
  );
}
function CheckLinks({
  checks,
  onCheck,
}: {
  checks: any[];
  onCheck?: (check: any) => void;
}) {
  return (
    <div className="check-links">
      {checks.map((c) => (
        <button
          key={c.id}
          onClick={() => onCheck?.(c)}
          disabled={!onCheck}
          className={c.passed ? "passed" : ""}
        >
          {c.passed ? <Check size={13} /> : <X size={13} />}
          <span>
            {c.name} · exit {c.exitCode ?? "unknown"}
          </span>
          {onCheck && <Arrow />}
        </button>
      ))}
    </div>
  );
}
function CasePage({
  identity,
  loading,
}: {
  identity: Session;
  loading: boolean;
}) {
  const { caseId } = useParams();
  const [value, setValue] = useState<Case | null>(null);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [artifact, setArtifact] = useState<{
    title: string;
    text: string;
  } | null>(null);
  const example = caseId === "example";
  useEffect(() => {
    setValue(null);
    setEvents([]);
    setError("");
    if (example || !identity || !caseId) return;
    let stop: undefined | (() => void);
    const controller = new AbortController();
    void api<Case>(`/cases/${caseId}`, { signal: controller.signal })
      .then((c) => {
        if (controller.signal.aborted) return;
        setValue(c);
        stop = watchCase(
          caseId,
          c,
          setValue,
          (e) => setEvents((old) => [...old, ...e].slice(-200)),
          setConnected,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => {
      controller.abort();
      stop?.();
    };
  }, [caseId, identity, example]);
  async function action(name: string) {
    if (!identity || !value) return;
    setBusy(true);
    setError("");
    try {
      const next = await mutate<Case>(
        `/cases/${value.id}/${name}`,
        identity.csrf,
        name === "approve" ? { digest: value.data.proposal?.digest } : {},
        name === "publish" ? `publish-${value.id}` : undefined,
      );
      if (next) setValue(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openCheck(c: any) {
    if (example) {
      setArtifact({
        title: c.name,
        text: `Labeled example\n${c.command}\nExit ${c.exitCode}\nCollected ${c.collected}\n${c.passed ? "Pass" : "Fail"}\nThis is an illustration, not a production artifact.`,
      });
      return;
    }
    setArtifact({ title: c.name, text: "Loading recorded output…" });
    try {
      if (!c.artifactId) {
        setArtifact({ title: c.name, text: JSON.stringify(c, null, 2) });
        return;
      }
      const response = await fetch(
        `/api/cases/${value!.id}/artifacts/${c.artifactId}`,
        { credentials: "same-origin" },
      );
      if (!response.ok) throw new Error("Artifact expired or unavailable");
      setArtifact({ title: c.name, text: await response.text() });
    } catch (e) {
      setArtifact({ title: c.name, text: (e as Error).message });
    }
  }
  if (example)
    return (
      <section className="example-page">
        <div className="demo-breadcrumb mono">
          <Link to="/">← THE IDEA</Link>
          <span>DISPOSABLE EXAMPLE / NO LIVE JOB</span>
          <Link to="/connect">
            Connect your repository <Arrow />
          </Link>
        </div>
        <Example />
        <div className="example-after">
          <h2>Same event. One notification.</h2>
          <p>
            The illustrative repair keeps the claim and durable outbox insertion
            in one transaction. A separate sender drains the outbox. Explore the
            recorded stages, then deliberately reintroduce the bug.
          </p>
          <Link className="text-link" to="/docs">
            How real verification works <Arrow />
          </Link>
        </div>
      </section>
    );
  return (
    <AuthGate identity={identity} loading={loading}>
      <section className="case-page">
        <div className="case-breadcrumb mono">
          <Link to="/studio">
            <ArrowLeft {...iconProps} /> CASES
          </Link>
          <span>CASE {caseId?.slice(0, 8)}</span>
          <span className={connected ? "connection-indicator" : "disconnected"}>
            <i />
            {connected ? "Connected" : "Reconnecting · job continues"}
          </span>
        </div>
        {error && (
          <Notice error>
            {error}
            <button onClick={() => window.location.reload()}>
              Refresh Case
            </button>
          </Notice>
        )}
        {value ? (
          <>
            <div className="case-heading">
              <div>
                <Label>Failure → Repair → Guard</Label>
                <h1>{value.title}</h1>
                <div className="snapshot-meta mono">
                  BASE {value.base_sha.slice(0, 12)}
                  <span>BRANCH {value.branch}</span>
                </div>
              </div>
              <span
                className={`state-chip ${value.state === "ready_for_review" || value.state === "pr_opened" ? "success" : ""}`}
                aria-live="polite"
              >
                {statusLabel(value.state)}
              </span>
            </div>
            {value.reason && (
              <Notice>
                {value.reason}
                {value.state === "needs_input" && (
                  <Link to={`/studio/repos/${value.repository_id}?new=1`}>
                    Capture a new Case with the missing input <Arrow />
                  </Link>
                )}
              </Notice>
            )}
            <ReplayStage value={value} onCheck={(c) => void openCheck(c)} />
            <div className="evidence-dock">
              <Label>Evidence dock</Label>
              <div>
                {(value.data.checks || []).map((c) => (
                  <button key={c.id} onClick={() => void openCheck(c)}>
                    {c.passed ? <Check size={13} /> : <X size={13} />}
                    <span>
                      {statusLabel(c.phase)} / {c.name}
                    </span>
                  </button>
                ))}
              </div>
              <a
                href={`/api/cases/${value.id}/export`}
                className="text-link"
                download
              >
                <Download {...iconProps} /> Export Case
              </a>
            </div>
            <div className="case-actions">
              {value.state === "ready_for_review" && (
                <>
                  <button
                    disabled={busy}
                    className="button"
                    onClick={() =>
                      void action(
                        value.data.approvedDigest ? "publish" : "approve",
                      )
                    }
                  >
                    {value.data.approvedDigest
                      ? "Publish draft PR"
                      : "Approve this proposal"}
                    <Arrow />
                  </button>
                  <button
                    disabled={busy}
                    className="button secondary"
                    onClick={() => void action("reject")}
                  >
                    Reject proposal
                  </button>
                </>
              )}
              {!terminal.has(value.state) && (
                <button
                  disabled={busy}
                  className="text-link"
                  onClick={() => void action("cancel")}
                >
                  Cancel Case <X {...iconProps} />
                </button>
              )}
              {value.data.prUrl && (
                <a
                  className="button"
                  href={value.data.prUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Review draft PR <ExternalLink {...iconProps} />
                </a>
              )}
              {terminal.has(value.state) && !value.archived && (
                <button
                  className="text-link"
                  onClick={() => void action("archive")}
                >
                  Archive Case
                </button>
              )}
            </div>
            <details className="event-log">
              <summary>Recent persisted events ({events.length})</summary>
              <pre>
                {events
                  .map(
                    (e) =>
                      `${e.sequence} · ${e.type} · ${JSON.stringify(e.payload)}\n`,
                  )
                  .join("") || "No new events since the loaded snapshot."}
              </pre>
            </details>
            <p className="scope-note">
              Verification is scoped to this snapshot and the recorded checks.
              Approval and publication are separate actions.
            </p>
          </>
        ) : (
          !error && (
            <Empty title="Opening the Case…">
              Loading its persisted snapshot.
            </Empty>
          )
        )}
      </section>
      {artifact && (
        <dialog open className="artifact-dialog" aria-label={artifact.title}>
          <header>
            <h2>{artifact.title}</h2>
            <button
              className="icon-button"
              aria-label="Close evidence"
              onClick={() => setArtifact(null)}
            >
              <X {...iconProps} />
            </button>
          </header>
          <pre>{artifact.text}</pre>
        </dialog>
      )}
    </AuthGate>
  );
}
function Guards({
  identity,
  loading,
}: {
  identity: Session;
  loading: boolean;
}) {
  const [guards, setGuards] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [details, setDetails] = useState<any>(null);
  useEffect(() => {
    if (identity)
      void api<any>("/guards")
        .then((r) => setGuards(r.guards))
        .catch((e) => setError(e.message));
  }, [identity]);
  return (
    <AuthGate identity={identity} loading={loading}>
      <section className="workspace">
        <Label>Behavior contracts</Label>
        <h1>Keep the lesson.</h1>
        <p className="lead">
          Every retained guard links a behavior to its original failure and the
          changes that followed.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="guard-list">
          {guards.map((g) => (
            <article key={g.id}>
              <ShieldCheck size={24} />
              <div>
                <h2>{g.contract}</h2>
                <Link to={`/studio/cases/${g.case_id}`}>
                  {g.case_title} <Arrow />
                </Link>
                <code>{g.test_name}</code>
              </div>
              <span className="state-chip">{g.validity}</span>
              <button
                className="text-link"
                onClick={() =>
                  void api<any>(`/guards/${g.id}`)
                    .then(setDetails)
                    .catch((e) => setError(e.message))
                }
              >
                Check history <Arrow />
              </button>
            </article>
          ))}
        </div>
        {!guards.length && (
          <Empty
            title="Nothing retained yet."
            action={
              <Link to="/studio" className="text-link">
                Return to Cases <Arrow />
              </Link>
            }
          >
            Verified repair PRs add their guards here. A missing or changed
            guard is flagged for review.
          </Empty>
        )}
        {details && (
          <dialog open className="artifact-dialog" aria-label="Guard history">
            <header>
              <h2>Guard check history</h2>
              <button
                className="icon-button"
                aria-label="Close guard history"
                onClick={() => setDetails(null)}
              >
                <X {...iconProps} />
              </button>
            </header>
            <pre>
              {details.checks.length
                ? JSON.stringify(details.checks, null, 2)
                : "No later PR checks recorded yet."}
            </pre>
          </dialog>
        )}
      </section>
    </AuthGate>
  );
}
function Settings({
  identity,
  theme,
  setTheme,
  motion,
  setMotion,
  logout,
}: {
  identity: Session;
  theme: string;
  setTheme: (t: string) => void;
  motion: boolean;
  setMotion: (v: boolean) => void;
  logout: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (identity)
      void api("/settings")
        .then(setSettings)
        .catch((e) => setError(e.message));
  }, [identity]);
  return (
    <section className="workspace settings">
      <Label>Your workbench</Label>
      <h1>Make space for the work.</h1>
      <div className="setting-row">
        <div>
          <h2>Appearance</h2>
          <p>Light and dark surfaces for code and evidence.</p>
        </div>
        <select
          aria-label="Workbench theme"
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
        >
          <option value="dark">Ink / dark</option>
          <option value="light">Chalk / light</option>
        </select>
      </div>
      <div className="setting-row">
        <div>
          <h2>Motion</h2>
          <p>Native reduced-motion preferences always take priority.</p>
        </div>
        <button
          className="button secondary"
          onClick={() =>
            setMotion(
              !motion &&
                !matchMedia("(prefers-reduced-motion: reduce)").matches,
            )
          }
        >
          {motion ? "Turn motion off" : "Turn motion on"}
        </button>
      </div>
      <div className="setting-row">
        <div>
          <h2>Connection</h2>
          <p>
            {identity
              ? `Signed in as ${identity.user.login}`
              : "No signed-in GitHub session"}
          </p>
        </div>
        {identity ? (
          <button
            className="button secondary"
            onClick={() => void logout().catch((e) => setError(e.message))}
          >
            Sign out everywhere
          </button>
        ) : (
          <Link className="button" to="/login">
            Sign in <Arrow />
          </Link>
        )}
      </div>
      {error && <Notice error>{error}</Notice>}
      {settings && (
        <>
          <div className="setting-row">
            <div>
              <h2>Runtime & retention</h2>
              <p>
                Build {settings.buildId} · Evidence retained{" "}
                {settings.retentionDays} days
              </p>
            </div>
            <Link to="/docs#limits" className="text-link">
              Read the boundaries <Arrow />
            </Link>
          </div>
          <pre>
            {JSON.stringify(
              { queue: settings.queue, budgets: settings.budgets },
              null,
              2,
            )}
          </pre>
        </>
      )}
    </section>
  );
}
