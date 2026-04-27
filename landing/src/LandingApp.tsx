import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import CodeIcon from '@mui/icons-material/Code';
import DrawOutlinedIcon from '@mui/icons-material/DrawOutlined';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import GitHubIcon from '@mui/icons-material/GitHub';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import MoneyOffRoundedIcon from '@mui/icons-material/MoneyOffRounded';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { AnimatedSVG } from './components/ui/AnimatedSVG';

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}
import {
  Box,
  Button,
  Container,
  CssBaseline,
  Fade,
  GlobalStyles,
  Link,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material';

function Reveal({
  children,
  delay = 0,
  threshold = 0.2,
}: {
  children: ReactElement;
  delay?: number;
  threshold?: number;
}) {
  const { ref, inView } = useInView(threshold);
  return (
    <Box ref={ref} sx={{ width: '100%' }}>
      <Fade in={inView} style={{ transitionDelay: inView ? `${delay}ms` : '0ms' }} timeout={760}>
        <Box>{children}</Box>
      </Fade>
    </Box>
  );
}

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#9b5cff',
      light: '#c89eff',
    },
    background: {
      default: '#090d16',
      paper: '#12192a',
    },
    text: {
      primary: '#f6f2ea',
      secondary: '#a8a2b5',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          transition: 'transform 0.18s ease, filter 0.18s ease',
          '&:hover': {
            transform: 'translateY(-2px)',
            filter: 'brightness(1.12) drop-shadow(0 0 14px rgba(155,92,255,0.35))',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          transition: 'transform 0.22s ease, filter 0.22s ease, border-color 0.22s ease',
        },
      },
    },
  },
  typography: {
    fontFamily: '"TeX Gyre PagellaX", Georgia, serif',
    h1: {
      fontWeight: 700,
      fontSize: 'clamp(2.4rem, 5vw, 4.5rem)',
      lineHeight: 1.08,
      letterSpacing: '-0.03em',
    },
    h4: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    body1: {
      fontSize: 'clamp(1rem, 1.4vw, 1.2rem)',
      lineHeight: 1.65,
    },
    body2: {
      fontSize: 'clamp(0.95rem, 1.2vw, 1.1rem)',
      lineHeight: 1.65,
    },
    button: {
      textTransform: 'none',
      fontWeight: 600,
      letterSpacing: '0.01em',
    },
  },
});

const examples = [
  {
    svg: '/landing-examples/example0.svg',
    svgStyle: 'width: 125.124px; height: 155.573px; overflow: visible;',
    scaledStyle: { width: Math.round(125.124 * 1.75), height: Math.round(155.573 * 1.75) },
  },
  {
    svg: '/landing-examples/example1.svg',
    svgStyle: 'width: 128.747px; height: 116.845px; overflow: visible;',
    scaledStyle: { width: Math.round(128.747 * 1.75), height: Math.round(116.845 * 1.75) },
  },
  {
    svg: '/landing-examples/example2.svg',
    svgStyle: 'width: 162.988px; height: 131.054px; overflow: visible;',
    scaledStyle: { width: Math.round(162.988 * 1.75), height: Math.round(131.054 * 1.75) },
  },
  {
    svg: '/landing-examples/example3.svg',
    svgStyle: 'width: 158.747px; height: 156.762px; overflow: visible;',
    scaledStyle: { width: Math.round(158.747 * 1.75), height: Math.round(156.762 * 1.75) },
  },
];

const stats = [
  {
    icon: <CodeIcon sx={{ fontSize: 36, color: 'primary.light' }} />,
    value: 'Open source',
    label: 'Every line of code is public on GitHub. Audit TikAD, fork TikAD, improve TikAD. Built in the open, for the community.',
  },
  {
    icon: <MoneyOffRoundedIcon sx={{ fontSize: 36, color: 'primary.light' }} />,
    value: 'Free forever',
    label: 'No hidden plans, no paywalls. TikAD is free to use today, tomorrow, and always — because good graphics should be accessible to everyone.',
  },
  {
    icon: <LockOpenRoundedIcon sx={{ fontSize: 36, color: 'primary.light' }} />,
    value: 'Open access',
    label: 'No account required. Just open TikAD and start drawing. No sign-up, no e-mail, no friction — just you and TikAD.',
  },
];

const guideSteps = [
  {
    title: 'LaTeX',
    kicker: 'The writing system',
    text: 'LaTeX is the gold standard for academic papers, theses, lecture notes, and technical documents. When quality matters, TikAD helps you create clean, beautiful diagrams powered by LaTeX.',
  },
  {
    title: 'TikZ',
    kicker: 'The drawing language',
    text: 'TikZ uses LaTeX to create high-impact scientific diagrams. TikAD helps you achieve the same professional results visually, while keeping full control of the code.',
  },
  {
    title: 'CircuitikZ',
    kicker: 'Electronics for TikZ',
    text: 'CircuitikZ is the reference library for drawing book-style electronic circuits in LaTeX, with hundreds of electronic symbols. TikAD gives you all that power through a familiar CAD-style visual editor.',
  },
  {
    title: 'SVG',
    kicker: 'Portable vector export',
    text: 'SVG is the standard modern format for vector graphics. Download it once and use it like any other image file in Word, PowerPoint, or on the web—with perfect quality at any size.',
  },
  {
    title: 'TikAD',
    kicker: 'The CAD editor',
    text: 'TikAD is the fastest way to create professional scientific figures in your browser. Draw visually like in a CAD tool, keep full control of the code, and export clean LaTeX or razor-sharp SVG graphics ready for papers, theses, slides, and websites.',
  },
];

export function LandingApp() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <GlobalStyles styles={`
        @font-face {
          font-family: "TeX Gyre PagellaX";
          src: url("/fonts/texgyrepagellax-regular.woff2") format("woff2");
          font-style: normal;
          font-weight: 400;
          font-display: swap;
        }
        @font-face {
          font-family: "TeX Gyre PagellaX";
          src: url("/fonts/texgyrepagellax-italic.woff2") format("woff2");
          font-style: italic;
          font-weight: 400;
          font-display: swap;
        }
        @font-face {
          font-family: "TeX Gyre PagellaX";
          src: url("/fonts/texgyrepagellax-bold.woff2") format("woff2");
          font-style: normal;
          font-weight: 700;
          font-display: swap;
        }
        @font-face {
          font-family: "TeX Gyre PagellaX";
          src: url("/fonts/texgyrepagellax-bolditalic.woff2") format("woff2");
          font-style: italic;
          font-weight: 700;
          font-display: swap;
        }
      `} />
      <GlobalStyles
        styles={(t) => ({
          body: {
            overflowX: 'hidden',
            backgroundColor: t.palette.background.default,
            backgroundImage: `
              radial-gradient(circle at 25% 20%, rgba(91,49,168,0.35), transparent 30%),
              radial-gradient(circle at 80% 55%, rgba(134,79,255,0.15), transparent 24%)
            `,
            minHeight: '100vh',
            width: '100%',
          },
          '#app': {
            minHeight: '100vh',
            width: '100%',
          },
        })}
      />

      <Box sx={{ color: 'text.primary', display: 'flex', flexDirection: 'column', minHeight: '100vh', position: 'relative' }}>

        {/* ── Navbar ── */}
        <Box
          component="nav"
          sx={{
            borderBottom: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(16px) saturate(140%) brightness(1.04)',
            backgroundColor: 'rgba(9, 13, 22, 0.12)',
            position: 'relative',
            zIndex: 10,
            py: 1.5,
          }}
        >
          <Container maxWidth="xl">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box component="img" src="/favicon.svg" alt="logo" sx={{ height: 32, width: 'auto', display: 'block' }} />
              <Box
                component="img"
                src="/tikad-wordmark.svg"
                alt="TikAD"
                sx={{ height: 32, width: 'auto', display: 'block', filter: 'brightness(0) invert(1)' }}
              />
            </Box>
          </Container>
        </Box>

        {/* ── Hero ── */}
        <Box sx={{
          minHeight: 'calc(100vh - 57px)', display: 'flex', alignItems: 'center', position: 'relative', py: { xs: 8, md: 10 },
          animation: 'fadeUp 0.7s ease both',
          '@keyframes fadeUp': {
            from: { opacity: 0, transform: 'translateY(18px)' },
            to:   { opacity: 1, transform: 'translateY(0)' },
          },
        }}>
          <Container maxWidth="xl" sx={{ zIndex: 1, display: 'flex', alignItems: 'center', gap: 4, overflow: 'visible' }}>

            {/* Left: text */}
            <Stack spacing={{ xs: 3, md: 4 }} sx={{ flexShrink: 0, maxWidth: { xs: '100%', lg: '40%' } }}>

              <Typography variant="h1">
                Create{' '}
                publication&#8209;quality{' '}
                schematics{' '}
                <Box component="span" sx={{ color: 'primary.light', fontStyle: 'italic' }}>
                  easily
                </Box>
                .
              </Typography>

              <Typography color="text.secondary" variant="body1" sx={{ maxWidth: 560 }}>
                TikAD is a free, open-source TikZ/CircuitikZ CAD editor for LaTeX circuit diagrams,{' '}
                electrical schematics, scientific figures, and SVG export. Draw visually, then use{' '}
                clean LaTeX or SVG in papers, theses, slides, Word documents, and websites. No registration required.
              </Typography>

              <Stack direction="row" spacing={3} useFlexGap flexWrap="wrap">
                {['CircuitikZ support', 'CAD-like editing', 'SVG export'].map((label) => (
                  <Stack key={label} direction="row" alignItems="center" spacing={0.5}>
                    <CheckRoundedIcon sx={{ fontSize: 18, color: 'primary.light' }} />
                    <Typography variant="body2" color="text.secondary">{label}</Typography>
                  </Stack>
                ))}
              </Stack>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap>
                <Button
                  component={Link}
                  href="https://go.tikad.app"
                  size="large"
                  startIcon={
                    <Box
                      component="img"
                      src="/favicon.svg"
                      alt=""
                      sx={{ display: 'block', height: 20, width: 20 }}
                    />
                  }
                  underline="none"
                  variant="contained"
                  sx={{ px: 3 }}
                >
                  Start drawing
                </Button>
                <Button
                  component={Link}
                  href="https://github.com/nt-phd/TikAD"
                  rel="noreferrer"
                  size="large"
                  startIcon={<GitHubIcon />}
                  target="_blank"
                  variant="outlined"
                  sx={{ px: 3 }}
                >
                  View on GitHub
                </Button>
              </Stack>

            </Stack>

            {/* Right: decorative block — visible only on large screens */}
            <Box
              sx={{
                display: { xs: 'none', lg: 'flex' },
                alignItems: 'flex-start',
                flex: 1,
                minWidth: 0,
                height: 0,
                overflow: 'visible',
                transform: 'rotate(-15deg)',
                transformOrigin: 'right top',
                zIndex: -1,
              }}
            >
            <Box sx={{ display: 'flex', flexDirection: 'row', gap: 14, alignItems: 'flex-start', transform: 'translateY(-50%) translateX(25%)' }}>
              {[0, 1].map((col) => (
                <Box key={col} sx={{ display: 'flex', flexDirection: 'column', gap: 5, mt: col === 1 ? 14 : 0 }}>
                  {examples.filter((_, i) => i % 2 === col).map((ex, j) => {
                    const i = col + j * 2;
                    return (
                <Stack
                  key={i}
                  spacing={0}
                  sx={{
                    position: 'relative',
                    opacity: 0,
                    animation: 'fadeUp 0.6s ease both',
                    animationDelay: `${0.2 + i * 0.15}s`,
                    width: 516,
                  }}
                >
                  {/* Drawing panel */}
                  <Paper
                    elevation={8}
                    variant="outlined"
                    sx={{
                      transition: 'filter 0.25s ease',
                      '&:hover': { filter: 'brightness(1.12) drop-shadow(0 0 18px rgba(155,92,255,0.25))' },
                      overflow: 'hidden',
                    }}
                  >
                    <Stack alignItems="center" direction="row" spacing={1} sx={{ bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 0.75 }}>
                      <DrawOutlinedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                      <Typography color="text.disabled" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>Drawing</Typography>
                    </Stack>
                    <Box sx={{ bgcolor: 'background.paper', p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
                      <Box sx={{ width: ex.scaledStyle.width, height: ex.scaledStyle.height }}>
                        <AnimatedSVG
                          src={ex.svg}
                          totalDuration={3200}
                          startDelay={200 + i * 150}
                          invert
                          idPrefix={`ex${i}`}
                          colorMap={{ [ex.svgStyle]: `width: ${ex.scaledStyle.width}px; height: ${ex.scaledStyle.height}px; overflow: visible;` }}
                        />
                      </Box>
                    </Box>
                  </Paper>

                  {/* Arrow */}
                  <Box sx={{
                    position: 'absolute',
                    left: -56,
                    top: '38%',
                    transformOrigin: '50% 70%',
                    transform: 'translateY(-50%) rotate(-90deg)',
                    opacity: 0,
                    animation: 'arrowIn 2.4s cubic-bezier(0.4,0,0.2,1) both',
                    animationDelay: `${1.0 + i * 0.15}s`,
                    '@keyframes arrowIn': {
                      from: { opacity: 0, transform: 'translateY(-50%) rotate(-45deg)' },
                      to:   { opacity: 0.07, transform: 'translateY(-50%) rotate(-90deg)' },
                    },
                    pointerEvents: 'none',
                    zIndex: -1,
                  }}>
                    <UndoRoundedIcon sx={{ fontSize: 120, color: 'primary.light' }} />
                  </Box>

                  {/* Code panel */}
                  <Paper
                    elevation={8}
                    variant="outlined"
                    sx={{
                      mt: 2,
                      transition: 'filter 0.25s ease',
                      '&:hover': { filter: 'brightness(1.12) drop-shadow(0 0 18px rgba(155,92,255,0.25))' },
                      overflow: 'hidden',
                    }}
                  >
                    <Stack alignItems="center" direction="row" spacing={1} sx={{ bgcolor: 'background.default', borderBottom: 1, borderColor: 'divider', px: 1.5, py: 0.75 }}>
                      <CodeRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                      <Typography color="text.disabled" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}>LaTeX</Typography>
                    </Stack>
                    <Box sx={{ bgcolor: 'background.paper', overflow: 'hidden' }}>
                      <AnimatedSVG
                        src={`/landing-examples/example${i}-code.svg`}
                        totalDuration={3200}
                        startDelay={800 + i * 150}
                        naturalSize
                      />
                    </Box>
                  </Paper>
                </Stack>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
          </Container>
        </Box>

        {/* ── Stats bar ── */}
        <Box
          sx={{
            borderTop: '1px solid rgba(255,255,255,0.10)',
            borderBottom: '1px solid rgba(255,255,255,0.10)',
            backdropFilter: 'blur(16px) saturate(140%) brightness(1.04)',
            backgroundColor: 'rgba(9, 13, 22, 0.12)',
            position: 'relative',
            zIndex: 2,
            py: { xs: 3, md: 3 },
          }}
        >
          <Container maxWidth="xl">
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 3,
              }}
            >
              {stats.map((item, i) => (
                <Reveal key={item.value} delay={i * 90} threshold={0.18}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: { xs: 2.5, md: 5 },
                      textAlign: 'center',
                      backgroundColor: 'rgba(255,255,255,0.04)',
                      backdropFilter: 'blur(12px)',
                      borderColor: 'rgba(255,255,255,0.10)',
                      transition: 'transform 0.22s ease, border-color 0.22s ease, background-color 0.22s ease, filter 0.22s ease',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        borderColor: 'rgba(200,158,255,0.35)',
                        backgroundColor: 'rgba(255,255,255,0.07)',
                        filter: 'brightness(1.12) drop-shadow(0 0 18px rgba(155,92,255,0.25))',
                      },
                    }}
                  >
                    <Stack alignItems="center" spacing={1.5}>
                      {item.icon}
                      <Typography color="primary.light" variant="h4">
                        {item.value}
                      </Typography>
                      <Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.7 }}>
                        {item.label}
                      </Typography>
                    </Stack>
                  </Paper>
                </Reveal>
              ))}
            </Box>
          </Container>
        </Box>

        {/* ── Guide ── */}
        <Box
          component="section"
          sx={{
            backgroundColor: 'background.default',
            position: 'relative',
            zIndex: 1,
            py: { xs: 7, md: 10 },
          }}
        >
          <Container maxWidth="xl">
            <Stack
              spacing={{ xs: 4, md: 6 }}
              sx={{
                alignItems: 'center',
                mx: 'auto',
                width: '100%',
              }}
            >
              <Reveal threshold={0.18}>
                <Stack
                  spacing={1.5}
                  sx={{
                    maxWidth: 860,
                    mx: 'auto',
                    textAlign: 'center',
                  }}
                >
                  <Typography color="primary.light" sx={{ fontWeight: 700, textTransform: 'uppercase', fontSize: '0.8rem', letterSpacing: '0.08em' }}>
                    From sketch to publication
                  </Typography>
                  <Typography variant="h4">
                    The tools behind publication-quality circuit diagrams
                  </Typography>
                  <Typography color="text.secondary" variant="body1">
                    TikAD combines the ease of CAD-like editing with the gold-standard formats used in publishing.
                  </Typography>
                </Stack>
              </Reveal>

              <Box
                sx={{
                  maxWidth: 1040,
                  mx: 'auto',
                  position: 'relative',
                  width: '100%',
                  '&::before': {
                    bgcolor: 'rgba(200,158,255,0.18)',
                    content: '""',
                    display: 'block',
                    left: { xs: 17, md: '50%' },
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    transform: { xs: 'none', md: 'translateX(-1px)' },
                    width: 2,
                  },
                }}
              >
                <Stack spacing={0}>
                  {guideSteps.map((step, index) => {
                    const alignRight = index % 2 === 0;
                    return (
                      <Reveal key={step.title} threshold={0.22}>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '36px 1fr', md: '1fr 72px 1fr' },
                            minHeight: { xs: 'auto', md: 184 },
                            position: 'relative',
                          }}
                        >
                          <Stack
                            spacing={0.5}
                            sx={{
                              alignSelf: 'center',
                              alignItems: alignRight ? 'flex-end' : 'flex-start',
                              display: { xs: 'none', md: 'flex' },
                              gridColumn: alignRight ? 1 : 3,
                              gridRow: 1,
                              px: 3,
                              textAlign: alignRight ? 'right' : 'left',
                            }}
                          >
                            {step.title === 'TikAD' ? (
                              <Box
                                component="img"
                                src="/tikad-wordmark.svg"
                                alt="TikAD"
                                sx={{
                                  display: 'block',
                                  filter: 'brightness(0) invert(1) drop-shadow(0 0 18px rgba(200,158,255,0.35))',
                                  height: 80,
                                  width: 'auto',
                                }}
                              />
                            ) : (
                              <Typography
                                sx={{
                                  color: 'rgba(246,242,234,0.72)',
                                  fontSize: { md: '1.75rem', lg: '2.15rem' },
                                  fontWeight: 700,
                                  lineHeight: 1,
                                }}
                              >
                                {step.title}
                              </Typography>
                            )}
                            <Typography
                              color="primary.light"
                              sx={{
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                              }}
                            >
                              {step.kicker}
                            </Typography>
                          </Stack>

                          <Box
                            sx={{
                              alignItems: 'center',
                              display: 'flex',
                              gridColumn: { xs: 1, md: 2 },
                              gridRow: 1,
                              justifyContent: 'center',
                              position: 'relative',
                            }}
                          >
                            <Box
                              sx={{
                                alignItems: 'center',
                                bgcolor: step.title === 'TikAD' ? 'transparent' : 'background.default',
                                border: step.title === 'TikAD' ? 0 : '2px solid',
                                borderColor: 'primary.light',
                                borderRadius: '50%',
                                boxShadow: step.title === 'TikAD'
                                  ? 'none'
                                  : '0 0 28px rgba(200,158,255,0.24)',
                                display: 'flex',
                                height: step.title === 'TikAD' ? 36 : 18,
                                justifyContent: 'center',
                                ml: step.title === 'TikAD' ? { xs: '-9px', md: 0 } : 0,
                                width: step.title === 'TikAD' ? 36 : 18,
                                zIndex: 1,
                              }}
                            >
                              {step.title === 'TikAD' && (
                                <Box
                                  component="img"
                                  src="/favicon.svg"
                                  alt=""
                                  sx={{
                                    display: 'block',
                                    filter: 'drop-shadow(0 0 14px rgba(200,158,255,0.78)) drop-shadow(0 0 30px rgba(155,92,255,0.38))',
                                    height: 36,
                                    width: 36,
                                  }}
                                />
                              )}
                            </Box>
                          </Box>

                          <Paper
                            variant="outlined"
                            sx={{
                              alignSelf: 'center',
                              backgroundColor: 'rgba(255,255,255,0.035)',
                              backdropFilter: 'blur(12px)',
                              borderColor: 'rgba(255,255,255,0.10)',
                              gridColumn: { xs: 2, md: alignRight ? 3 : 1 },
                              gridRow: 1,
                              mb: { xs: index === guideSteps.length - 1 ? 0 : 3, md: 0 },
                              p: { xs: 2.5, md: 3 },
                              transition: 'transform 0.22s ease, border-color 0.22s ease, background-color 0.22s ease',
                              ...(step.title === 'TikAD' && {
                                backgroundColor: 'rgba(155,92,255,0.10)',
                                borderColor: 'rgba(200,158,255,0.32)',
                              }),
                              '&:hover': {
                                transform: { xs: 'none', md: alignRight ? 'translateX(6px)' : 'translateX(-6px)' },
                                borderColor: 'rgba(200,158,255,0.38)',
                                backgroundColor: 'rgba(255,255,255,0.06)',
                              },
                            }}
                          >
                            <Stack spacing={1}>
                              <Typography color="text.secondary" sx={{ display: { xs: 'block', md: 'none' }, fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {step.kicker}
                              </Typography>
                              <Typography variant="h4" sx={{ display: { xs: 'block', md: 'none' }, fontSize: '1.45rem' }}>
                                {step.title}
                              </Typography>
                              <Typography color="text.secondary" variant="body2">
                                {step.text}
                              </Typography>
                            </Stack>
                          </Paper>
                        </Box>
                      </Reveal>
                    );
                  })}
                </Stack>
              </Box>

              <Reveal threshold={0.18}>
                <Box
                  sx={{
                    borderTop: '1px solid rgba(255,255,255,0.10)',
                    maxWidth: 1040,
                    mx: 'auto',
                    pt: 3,
                    width: '100%',
                  }}
                >
                  <Typography color="text.secondary" variant="body2">
                    The result is a simple path from idea to final figure: draw the circuit schematic visually, refine it like
                    a CAD project, export CircuitikZ or TikZ code for LaTeX, or save a resolution-independent SVG for Word,
                    PowerPoint, web pages, documentation, and blog posts. TikAD is open source, browser-based, free to use,
                    and does not require an account.
                  </Typography>
                </Box>
              </Reveal>
            </Stack>
          </Container>
        </Box>

      </Box>
    </ThemeProvider>
  );
}
