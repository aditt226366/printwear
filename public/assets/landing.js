const canvas = document.querySelector("#landingOrbCanvas");

if (canvas) {
  const context = canvas.getContext("2d", { alpha: true });
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const state = {
    width: 0,
    height: 0,
    dpr: 1,
    particles: [],
    start: performance.now(),
    scrollProgress: 0
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function mix(a, b, t) {
    return a + (b - a) * t;
  }

  function resize() {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);
    state.width = Math.max(1, window.innerWidth);
    state.height = Math.max(1, window.innerHeight);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    createParticles();
    updateScrollProgress();
  }

  function updateScrollProgress() {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    state.scrollProgress = clamp((window.scrollY || 0) / maxScroll, 0, 1);
  }

  function createParticles() {
    const rings = [0.18, 0.27, 0.36, 0.45, 0.54, 0.63, 0.72, 0.81, 0.9];
    state.particles = rings.flatMap((radiusUnit, ringIndex) => {
      const count = 80 + ringIndex * 34;
      return Array.from({ length: count }, (_, index) => {
        const turn = index / count;
        return {
          angle: Math.PI * 2 * turn + ringIndex * 0.19,
          radiusUnit,
          ringIndex,
          size: 0.55 + (index % 7) * 0.25 + ringIndex * 0.02,
          speed: (ringIndex % 2 ? -1 : 1) * (0.000026 + ringIndex * 0.000002),
          pulse: turn * Math.PI * 2 + ringIndex * 0.61
        };
      });
    });
  }

  function getOrbModel(progress) {
    const toColumn = smoothstep(0.08, 0.34, progress);
    const toCards = smoothstep(0.34, 0.58, progress);
    const toRightOrb = smoothstep(0.58, 0.82, progress);

    const hero = {
      cx: state.width * 0.82,
      cy: state.height * 0.7,
      radius: Math.min(state.width, state.height) * 0.78,
      scaleX: 1.18,
      scaleY: 0.52,
      phase: 0,
      opacity: 0.92
    };
    const column = {
      cx: state.width * 0.52,
      cy: state.height * 0.5,
      radius: Math.min(state.width, state.height) * 0.72,
      scaleX: 0.28,
      scaleY: 1.72,
      phase: Math.PI * 0.5,
      opacity: 0.82
    };
    const cards = {
      cx: state.width * 0.5,
      cy: state.height * 0.45,
      radius: Math.min(state.width, state.height) * 0.6,
      scaleX: 1.18,
      scaleY: 0.72,
      phase: Math.PI * 0.9,
      opacity: 0.56
    };
    const right = {
      cx: state.width * 0.78,
      cy: state.height * 0.47,
      radius: Math.min(state.width, state.height) * 0.62,
      scaleX: 0.9,
      scaleY: 0.9,
      phase: Math.PI * 1.3,
      opacity: 0.76
    };

    const a = {
      cx: mix(hero.cx, column.cx, toColumn),
      cy: mix(hero.cy, column.cy, toColumn),
      radius: mix(hero.radius, column.radius, toColumn),
      scaleX: mix(hero.scaleX, column.scaleX, toColumn),
      scaleY: mix(hero.scaleY, column.scaleY, toColumn),
      phase: mix(hero.phase, column.phase, toColumn),
      opacity: mix(hero.opacity, column.opacity, toColumn)
    };

    const b = {
      cx: mix(a.cx, cards.cx, toCards),
      cy: mix(a.cy, cards.cy, toCards),
      radius: mix(a.radius, cards.radius, toCards),
      scaleX: mix(a.scaleX, cards.scaleX, toCards),
      scaleY: mix(a.scaleY, cards.scaleY, toCards),
      phase: mix(a.phase, cards.phase, toCards),
      opacity: mix(a.opacity, cards.opacity, toCards)
    };

    return {
      cx: mix(b.cx, right.cx, toRightOrb),
      cy: mix(b.cy, right.cy, toRightOrb),
      radius: mix(b.radius, right.radius, toRightOrb),
      scaleX: mix(b.scaleX, right.scaleX, toRightOrb),
      scaleY: mix(b.scaleY, right.scaleY, toRightOrb),
      phase: mix(b.phase, right.phase, toRightOrb),
      opacity: mix(b.opacity, right.opacity, toRightOrb)
    };
  }

  function drawRings(model, motion) {
    context.save();
    context.translate(model.cx, model.cy);
    context.rotate(model.phase + motion * 0.000026 + state.scrollProgress * Math.PI * 0.45);
    context.scale(model.scaleX, model.scaleY);

    for (let ring = 0; ring < 9; ring += 1) {
      const radius = model.radius * (0.18 + ring * 0.09);
      context.beginPath();
      context.lineWidth = ring < 3 ? 1.15 : 0.75;
      context.strokeStyle = `rgba(95, 224, 255, ${(0.16 - ring * 0.012) * model.opacity})`;
      context.shadowColor = "rgba(72, 217, 255, 0.7)";
      context.shadowBlur = 22;
      context.arc(0, 0, radius + Math.sin(motion * 0.00085 + ring) * 4, 0, Math.PI * 2);
      context.stroke();
    }

    context.restore();
  }

  function drawParticles(model, motion) {
    context.save();
    context.translate(model.cx, model.cy);
    context.rotate(model.phase + motion * 0.000035 + state.scrollProgress * Math.PI * 0.55);
    context.scale(model.scaleX, model.scaleY);

    state.particles.forEach((particle) => {
      const angle = particle.angle + motion * particle.speed + state.scrollProgress * 0.9;
      const wave = Math.sin(motion * 0.0011 + particle.pulse + state.scrollProgress * 5) * 0.022;
      const radius = model.radius * (particle.radiusUnit + wave);
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const shellDepth = 0.55 + Math.cos(angle + model.phase) * 0.45;
      const opacity = clamp((0.12 + shellDepth * 0.42 + particle.ringIndex * 0.028) * model.opacity, 0.08, 0.78);

      context.beginPath();
      context.fillStyle = `rgba(112, 230, 255, ${opacity})`;
      context.shadowColor = "rgba(71, 217, 255, 0.95)";
      context.shadowBlur = 10 + particle.ringIndex * 2.6;
      context.arc(x, y, particle.size * (0.85 + shellDepth * 0.6), 0, Math.PI * 2);
      context.fill();
    });

    context.restore();
  }

  function draw(now) {
    const elapsed = now - state.start;
    const motion = reduceMotion ? 0 : elapsed;
    const progress = reduceMotion ? state.scrollProgress : mix(state.scrollProgress, state.scrollProgress, 1);
    const model = getOrbModel(progress);
    const glow = context.createRadialGradient(model.cx, model.cy, 0, model.cx, model.cy, model.radius * 1.1);

    context.clearRect(0, 0, state.width, state.height);
    glow.addColorStop(0, `rgba(178, 247, 255, ${0.32 * model.opacity})`);
    glow.addColorStop(0.2, `rgba(67, 212, 255, ${0.22 * model.opacity})`);
    glow.addColorStop(0.52, `rgba(20, 104, 255, ${0.08 * model.opacity})`);
    glow.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, state.width, state.height);

    drawRings(model, motion);
    drawParticles(model, motion);

    if (!reduceMotion) {
      requestAnimationFrame(draw);
    }
  }

  window.addEventListener("resize", resize, { passive: true });
  window.addEventListener("scroll", () => {
    updateScrollProgress();
    if (reduceMotion) {
      draw(performance.now());
    }
  }, { passive: true });

  resize();
  requestAnimationFrame(draw);
}

const featureWorkflows = {
  conversations: {
    label: "WhatsApp Conversations",
    steps: ["Incoming Message", "AI Suggestion", "Manual Reply", "Resolved"]
  },
  leads: {
    label: "Lead Management",
    steps: ["New Lead", "Hot/Warm/Scrap", "Assigned", "Follow-up"]
  },
  bulk: {
    label: "Bulk Messaging",
    steps: ["Audience", "Template", "Send Queue", "Delivery Status"]
  },
  campaigns: {
    label: "Campaigns",
    steps: ["Segment", "Sequence", "Reply Tracking", "Conversion"]
  },
  ads: {
    label: "Ads",
    steps: ["Click-to-WhatsApp", "Lead Captured", "Source Tagged", "Inbox"]
  },
  ai: {
    label: "AI Workflow Builder",
    steps: ["Trigger", "Condition", "AI Reply", "Human Handoff"]
  },
  queue: {
    label: "Human Queue",
    steps: ["AI Escalation", "Priority Review", "Manual Reply", "Return to AI"]
  },
  orders: {
    label: "Orders",
    steps: ["Order Request", "Details Captured", "Status Updated", "WhatsApp Sent"]
  }
};

const featureNodes = Array.from(document.querySelectorAll(".feature-node"));
const workflowRail = document.querySelector("#workflowRail");
const workflowLabel = document.querySelector("#workflowFeatureLabel");
const workflowStrip = document.querySelector(".workflow-strip");

function renderWorkflow(featureKey) {
  const workflow = featureWorkflows[featureKey] || featureWorkflows.conversations;
  if (!workflowRail || !workflowLabel || !workflowStrip) return;

  workflowLabel.textContent = workflow.label;
  workflowRail.replaceChildren();

  const line = document.createElement("span");
  line.className = "workflow-line";
  line.setAttribute("aria-hidden", "true");
  workflowRail.appendChild(line);

  const pulse = document.createElement("span");
  pulse.className = "workflow-pulse";
  pulse.setAttribute("aria-hidden", "true");
  workflowRail.appendChild(pulse);

  workflow.steps.forEach((step) => {
    const node = document.createElement("span");
    node.className = "workflow-step";
    node.textContent = step;
    workflowRail.appendChild(node);
  });

  workflowStrip.classList.remove("is-changing");
  void workflowStrip.offsetWidth;
  workflowStrip.classList.add("is-changing");
}

featureNodes.forEach((node) => {
  node.setAttribute("aria-pressed", node.classList.contains("is-active") ? "true" : "false");
  node.addEventListener("click", () => {
    const featureKey = node.dataset.feature || "conversations";
    featureNodes.forEach((item) => {
      const isActive = item === node;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
    renderWorkflow(featureKey);
  });
});

renderWorkflow("conversations");

const aiSection = document.querySelector(".landing-ai-section");
if (aiSection && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      document.body.classList.toggle("ai-showcase-focus", entry.isIntersecting && entry.intersectionRatio > 0.28);
    });
  }, { threshold: [0.1, 0.28, 0.5] });
  observer.observe(aiSection);
}
