import Link from "next/link";

const Arrow = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20">
    <path d="M4 10h11M11 5l5 5-5 5" />
  </svg>
);

const Mark = () => (
  <svg aria-hidden="true" className="brand-mark" viewBox="0 0 40 40">
    <path d="M14.4 29.5h14.8l1.6 4.5H9.2l1.6-4.5h3.6Zm1.7-2.7-2.2-10.7 4.6-2.6-2.1-4.2 8.3-3.1-1 5.3 4.4 3.2-4 12.1h-8Z" />
  </svg>
);

export default function Home() {
  return (
    <main className="landing">
      <nav className="site-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="Knight Riders Chess Academy home">
          <Mark />
          <span>Knight Riders</span>
          <small>Chess Academy</small>
        </Link>
        <div className="nav-links">
          <a href="#method">Our method</a>
          <a href="#experience">Experience</a>
          <Link href="/login">Sign in</Link>
        </div>
        <div className="nav-links mobile-signin">
          <Link href="/login">Sign in</Link>
        </div>
        <Link className="button button-dark nav-cta" href="/signup">
          Join the academy <Arrow />
        </Link>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow hero-reveal">Private chess education, reimagined</div>
          <h1 className="hero-reveal delay-1">
            Think deeper.
            <br />
            Play <em>braver.</em>
          </h1>
          <p className="hero-intro hero-reveal delay-2">
            A focused learning space where ambitious players train with expert
            guidance, purposeful puzzles, and a plan built around their game.
          </p>
          <div className="hero-actions hero-reveal delay-3">
            <Link className="button button-accent" href="/signup">
              Start your journey <Arrow />
            </Link>
            <a className="text-link" href="#method">
              See how it works <span aria-hidden="true">↓</span>
            </a>
          </div>
          <div className="hero-proof hero-reveal delay-4">
            <div className="avatars" aria-hidden="true">
              <span>AK</span><span>JS</span><span>MR</span><span>+</span>
            </div>
            <p><strong>Built for progress</strong><br />One move at a time.</p>
          </div>
        </div>

        <div className="hero-visual hero-reveal delay-2" aria-label="Interactive chess lesson preview">
          <div className="visual-topline">
            <span>Today&apos;s position</span>
            <span className="live-dot">Lesson 08</span>
          </div>
          <div className="board-shell">
            <div className="chess-board" aria-hidden="true">
              <span className="piece black-king">♚</span>
              <span className="piece black-pawn">♟</span>
              <span className="piece white-queen">♕</span>
              <span className="piece white-rook">♖</span>
              <span className="piece white-king">♔</span>
            </div>
            <div className="rank-labels" aria-hidden="true"><span>8</span><span>7</span><span>6</span><span>5</span><span>4</span><span>3</span><span>2</span><span>1</span></div>
            <div className="file-labels" aria-hidden="true"><span>a</span><span>b</span><span>c</span><span>d</span><span>e</span><span>f</span><span>g</span><span>h</span></div>
          </div>
          <div className="lesson-card">
            <span className="lesson-icon">◎</span>
            <div><small>Coach&apos;s challenge</small><strong>White to move. Find the finish.</strong></div>
            <span className="lesson-time">02:14</span>
          </div>
          <div className="floating-note">Tactical vision<br /><strong>+24 XP</strong></div>
        </div>
      </section>

      <div className="marquee" aria-label="Learning topics">
        <div>
          <span>Pattern recognition</span><i>◆</i><span>Strategic thinking</span><i>◆</i>
          <span>Deliberate practice</span><i>◆</i><span>Confident play</span><i>◆</i>
          <span>Pattern recognition</span><i>◆</i><span>Strategic thinking</span>
        </div>
      </div>

      <section className="method" id="method">
        <div className="section-heading">
          <div>
            <span className="eyebrow">A smarter way to improve</span>
            <h2>Every move has<br />a reason.</h2>
          </div>
          <p>Knight Riders turns practice into a clear, rewarding path—guided by your tutor and shaped by how you actually play.</p>
        </div>

        <div className="feature-grid">
          <article className="feature feature-large">
            <div className="feature-number">01</div>
            <div className="feature-art puzzle-art" aria-hidden="true">
              <span className="mini-card card-one"><b>♞</b><small>Fork</small></span>
              <span className="mini-card card-two"><b>♜</b><small>Pin</small></span>
              <span className="mini-card card-three"><b>♛</b><small>Finish</small></span>
            </div>
            <div className="feature-copy"><h3>Practice that fits you</h3><p>Puzzles calibrated to your level, selected with purpose—not an endless random feed.</p></div>
          </article>
          <article className="feature feature-tall">
            <div className="feature-number">02</div>
            <div className="feature-art progress-art" aria-hidden="true">
              <div className="progress-ring"><span>72<small>%</small></span></div>
              <div className="progress-label"><span>This week</span><strong>Sharp tactical form</strong></div>
              <div className="bars"><i /><i /><i /><i /><i /><i /><i /></div>
            </div>
            <div className="feature-copy"><h3>Progress you can see</h3><p>Watch consistency become confidence through ratings, streaks, and meaningful milestones.</p></div>
          </article>
          <article className="feature feature-wide">
            <div className="feature-number">03</div>
            <div className="feature-copy"><h3>Your tutor, in your corner</h3><p>Personal assignments connect every lesson to focused work between sessions.</p></div>
            <div className="coach-message">
              <span className="coach-avatar">SN</span>
              <div><small>Coach Sofia · just now</small><p>Great calculation. Now find the quieter move.</p></div>
              <span className="message-check">✓✓</span>
            </div>
          </article>
        </div>
      </section>

      <section className="experience" id="experience">
        <div className="quote-mark">“</div>
        <blockquote>
          Chess is not about seeing the right move. It&apos;s about learning how to <em>look.</em>
        </blockquote>
        <div className="quote-by"><span /><p><strong>Sofia Novak</strong><br />Founder & chess coach</p></div>
      </section>

      <section className="steps">
        <div className="steps-intro">
          <span className="eyebrow">Your next move</span>
          <h2>From curious<br />to capable.</h2>
          <p>No noise. No shortcuts. Just a practice rhythm that makes improvement inevitable.</p>
          <Link className="button button-dark" href="/signup">Create your account <Arrow /></Link>
        </div>
        <ol className="step-list">
          <li><span>01</span><div><h3>Join your tutor&apos;s class</h3><p>Use your private invite and set your starting level.</p></div><b>→</b></li>
          <li><span>02</span><div><h3>Get your training plan</h3><p>Receive focused puzzle sets chosen for your game.</p></div><b>→</b></li>
          <li><span>03</span><div><h3>Build a winning habit</h3><p>Solve, learn, collect rewards, and watch your game grow.</p></div><b>→</b></li>
        </ol>
      </section>

      <section className="final-cta">
        <div className="final-piece" aria-hidden="true">♞</div>
        <span className="eyebrow">The board is ready</span>
        <h2>Make your<br /><em>next move.</em></h2>
        <p>Join your academy and turn thoughtful practice into your strongest game yet.</p>
        <Link className="button button-accent" href="/signup">Begin learning <Arrow /></Link>
      </section>

      <footer>
        <Link className="brand footer-brand" href="/"><Mark /><span>Knight Riders</span><small>Chess Academy</small></Link>
        <p>Chess education for the next generation of thinkers.</p>
        <div><Link href="/login">Sign in</Link><Link href="/signup">Join academy</Link></div>
        <small>© {new Date().getFullYear()} Knight Riders Chess Academy</small>
      </footer>
    </main>
  );
}
