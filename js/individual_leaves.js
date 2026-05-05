const W = 980, H = 500, RADIUS = W / 2 - 30;

// Safely extract the full display name from a data entry that may be either
// a plain string (legacy) or an object with various possible name fields.
function getEntryName(entry) {
  if (typeof entry === "string") return entry;
  return entry?.name || entry?.label || entry?.text || entry?.short_label || entry?.shortLabel || entry?.short || "";
}

// Like getEntryName but prefers the shorter label variants first,
// used for compact arc labels where space is limited.
function getEntryShortLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry?.short_label || entry?.shortLabel || entry?.short || entry?.name || entry?.label || entry?.text || "";
}

function normalizeData(raw) {
  // Already in the expected D3-ready hierarchy shape (legacy / pre-processed data).
  if (raw && Array.isArray(raw.children)) return raw;

  // Helper: extract both the full name and the short label from any entry object.
  const getEntryText = entry => ({
    name: getEntryName(entry),
    shortLabel: getEntryShortLabel(entry)
  });

  if (raw && Array.isArray(raw.sections)) {
    const palette = ["#f78da7", "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#00d084", "#8ed1fc", "#0693e3", "#9b51e0"];

    return {
      name: raw.name || "Ethics Framework",
      children: raw.sections.map((section, i) => ({
        name: section.name,
        color: palette[i % palette.length],
        children: (section.subcategories || []).map(sc => {
          const subcategory = getEntryText(sc);
          return {
            name: subcategory.name,
            shortLabel: subcategory.shortLabel,
            children: (sc.risks || []).map(riskEntry => {
              const risk = getEntryText(riskEntry);
              return {
                name: risk.name,
                shortLabel: risk.shortLabel,
                type: "risk",
                value: 1,
                checklist: sc.checks || [],
                children: [
                  {
                    // Outer ring: best practices shared by all risks in this subcategory.
                    name: "Best Practices",
                    type: "bestpractice-block",
                    value: 1,
                    content: sc.best_practices || [],
                    checklist: sc.checks || [],
                    children: [
                      {
                        // Outermost ring: checklist items for this subcategory.
                        name: "Checklist",
                        type: "checklist-block",
                        value: 1,
                        content: sc.checks || []
                      }
                    ]
                  }
                ]
              };
            })
          };
        })
      }))
    };
  }

  throw new Error("Unsupported data format in heritage_checklist.json");
}

function loadData() {
  if (!window.HERITAGE_DATA) {
    return Promise.reject(new Error("Could not load data from heritage_checklist.js"));
  }

  return Promise.resolve(window.HERITAGE_DATA).then(normalizeData);
}

// Maps depth index to a fill colour function for each ring:
// depth 1 = subcategory (purple), 2 = risk (blue), 3 = best practices (amber), 4 = checklist (green).
const depthColors = {
  1: d => "#9b51e0",
  2: d => "#8ed1fc",
  3: d => "#fcb900",
  4: d => "#7bdcb5",
};

// Returns a human-readable ring label for use in tooltips.
function nodeLabel(d) {
  if (d.data.type === "risk") return "Risk";
  if (d.data.type === "bestpractice-block") return "Best Practices";
  if (d.data.type === "checklist-block") return "Checklist";
  return ["", "Section", "Subcategory", "Risk", "Best Practices"][d.depth] || "Item";
}

const tooltip = document.getElementById("tooltip");
// tipPinned: when true (after a click), the tooltip stays visible until the
// user clicks elsewhere on the document.
let tipPinned = false;

// Normalise mouse and touch events to a single {x, y} screen coordinate.
function eventPoint(event) {
  const e = event?.touches?.[0] || event?.changedTouches?.[0] || event;
  return { x: e?.clientX ?? 0, y: e?.clientY ?? 0 };
}

// Show the tooltip with HTML content and position it near the cursor.
function showTip(event, text) {
  tooltip.style.opacity = 1;
  tooltip.innerHTML = text;
  moveTip(event);
}

// Track cursor movement so the tooltip follows the pointer.
function moveTip(event) {
  const p = eventPoint(event);
  tooltip.style.left = (p.x + 14) + "px";
  tooltip.style.top  = (p.y - 28) + "px";
}

// Hide the tooltip unless it has been pinned by a click.
function hideTip(force = false) {
  if (tipPinned && !force) return;
  tooltip.style.opacity = 0;
}

// Clicking anywhere outside an arc clears the pinned tooltip.
document.addEventListener("click", () => {
  tipPinned = false;
  hideTip(true);
});

// Build a 180° fan (half-circle) sunburst for a single category section.
// rootData is a sub-hierarchy rooted at one category node.
function buildSunburst(rootData, container) {
  const root = d3.hierarchy(rootData)
    .sum(d => {
      // Angular size is proportional to text content at leaf nodes.
      // We apply a power-law compression (exponent < 1) so that nodes with
      // very long names don't dominate and short-named nodes stay readable.
      // Only leaf nodes carry a value; parent nodes sum their children.
      if (!d.children || d.children.length === 0) {
        const base     = (d.name || "").length;
        const bpLen    = (d.content   || []).reduce((n, t) => n + getEntryName(t).length, 0);
        const checksLen= (d.checklist || []).reduce((n, t) => n + getEntryName(t).length, 0);
        const rawWeight       = Math.max(1, base + bpLen * 0.35 + checksLen * 0.2);
        const compressedWeight = 8 + Math.pow(rawWeight, 0.72);
        return Math.max(1, compressedWeight);
      }
      return 0;
    })
    .sort((a, b) => b.value - a.value);

  const FAN = Math.PI;          // 180-degree fan
  const FAN_OFFSET = -Math.PI / 2; // centre it: arcs run from −90° to +90°

  const partition = d3.partition().size([FAN, RADIUS]);
  partition(root);

  // Override d3.partition's default equal-height rings with custom radial weights.
  // Each depth gets a relative weight; the weights are normalised to [0, RADIUS].
  // Larger weight → thicker ring → more room for labels.
  const maxDepth = d3.max(root.descendants(), d => d.depth) || 0;
  const depthWeights = Array.from({ length: maxDepth + 1 }, (_, depth) => {
    if (depth === 0) return 0.55; // centre hub (section name)
    if (depth === 1) return 0.95; // subcategory ring
    if (depth === 2) return 1.0;  // risk ring
    if (depth === 3) return 1.2;  // best-practices ring – slightly taller
    if (depth === 4) return 1.3;  // checklist ring – tallest outer ring
    return 1.0;
  });

  // Convert weights to absolute radial start positions for each depth.
  const totalWeight = d3.sum(depthWeights);
  const depthStart = [];
  let running = 0;
  depthWeights.forEach((w, depth) => {
    depthStart[depth] = running;
    running += w;
  });

  // Write y0/y1 (inner/outer radius) back onto every node.
  root.descendants().forEach(d => {
    d.y0 = (depthStart[d.depth] / totalWeight) * RADIUS;
    d.y1 = ((depthStart[d.depth] + depthWeights[d.depth]) / totalWeight) * RADIUS;
  });

  // Arc generator. Pads are removed on the outer two rings (depth ≥ 3) to
  // avoid thin slivers disappearing at small segment sizes.
  const arc = d3.arc()
    .startAngle(d => d.x0 + FAN_OFFSET)
    .endAngle(d => d.x1 + FAN_OFFSET)
    .padAngle(d => d.depth >= 3 ? 0 : Math.min((d.x1 - d.x0) / 2, 0.02))
    .padRadius(RADIUS / 2)
    .innerRadius(d => d.y0)
    .outerRadius(d => d.y1 - 2);

  const svg = d3.create("svg")
    .attr("width", W)
    .attr("height", H)
    .attr("viewBox", `0 0 ${W} ${H}`)
    .style("font-family", "Segoe UI, Arial, sans-serif");

  // Inline legend rendered inside the SVG so it is preserved when exporting.
  const inlineLegend = [
    { label: "Subcategory", color: "#9b51e0" },
    { label: "Risks",       color: "#8ed1fc" },
    { label: "Best Practices", color: "#fcb900" },
    { label: "Checklist",   color: "#7bdcb5" }
  ];

  const legendGroup = svg.append("g")
    .attr("class", "inline-legend")
    .attr("transform", "translate(26,22)");

  const legendItem = legendGroup.selectAll("g")
    .data(inlineLegend)
    .join("g")
    .attr("transform", (_, i) => `translate(${i * 118},0)`);

  legendItem.append("rect")
    .attr("x", 0)
    .attr("y", -9)
    .attr("width", 14)
    .attr("height", 14)
    .attr("rx", 3)
    .attr("fill", d => d.color);

  legendItem.append("text")
    .attr("x", 20)
    .attr("y", 2)
    .attr("font-size", 11)
    .attr("fill", "#4a5568")
    .text(d => d.label);

  const g = svg.append("g")
    .attr("transform", `translate(${W/2},${H - 8})`); // bottom-centre, fan opens upward

  // Draw one <path> per hierarchy node (skip depth 0 – the invisible root hub).
  // Mouseover/click/touchstart all trigger the tooltip; click also pins it.
  g.selectAll("path")
    .data(root.descendants().filter(d => d.depth > 0))
    .join("path")
      .attr("d", arc)
      .attr("fill", d => {
        const fn = depthColors[d.depth];
        return fn ? fn(d) : "#ccc";
      })
      .attr("stroke", d => d.depth >= 3 ? "none" : "#fff")
      .attr("stroke-width", d => d.depth >= 3 ? 0 : 0.5)
      .style("cursor", "default")
    .on("mouseover", (event, d) => {
        tipPinned = false;
        const label = nodeLabel(d);
        const extra = d.data.type === "bestpractice-block" || d.data.type === "checklist-block"
          ? `<br>${(d.data.content || []).map(t => `• ${getEntryName(t)}`).join("<br>")}`
          : "";
        showTip(event, `<strong>${label}:</strong><br>${d.data.name}${extra}`);
      })
    .on("mousemove", moveTip)
    .on("mouseleave", () => hideTip())
    .on("click", (event, d) => {
      event.stopPropagation();
      tipPinned = true;
      const label = nodeLabel(d);
      const extra = d.data.type === "bestpractice-block" || d.data.type === "checklist-block"
        ? `<br>${(d.data.content || []).map(t => `• ${getEntryName(t)}`).join("<br>")}`
        : "";
      showTip(event, `<strong>${label}:</strong><br>${d.data.name}${extra}`);
    })
    .on("touchstart", (event, d) => {
      event.stopPropagation();
      tipPinned = true;
      const label = nodeLabel(d);
      const extra = d.data.type === "bestpractice-block" || d.data.type === "checklist-block"
        ? `<br>${(d.data.content || []).map(t => `• ${getEntryName(t)}`).join("<br>")}`
        : "";
      showTip(event, `<strong>${label}:</strong><br>${d.data.name}${extra}`);
    });

  // Draw thin white radial lines on the outer two rings (best-practices and checklist)
  // at every subcategory boundary angle, so it is clear which slices belong together.
  const depth3Nodes = root.descendants().filter(d => d.depth === 3);
  const depth4Nodes = root.descendants().filter(d => d.depth === 4);
  const ring3Inner = d3.min(depth3Nodes, d => d.y0);
  const ring4Outer = d3.max(depth4Nodes.length ? depth4Nodes : depth3Nodes, d => d.y1);

  if (ring3Inner != null && ring4Outer != null) {
    const boundaryAngles = Array.from(new Set(
      root.descendants()
        .filter(d => d.depth === 1)
        .flatMap(d => [d.x0, d.x1])
        .map(a => a.toFixed(6))
    )).map(a => +a);

    g.append("g")
      .attr("class", "subcategory-boundaries")
      .selectAll("line")
      .data(boundaryAngles)
      .join("line")
      .attr("x1", a => Math.sin(a + FAN_OFFSET) * ring3Inner)
      .attr("y1", a => -Math.cos(a + FAN_OFFSET) * ring3Inner)
      .attr("x2", a => Math.sin(a + FAN_OFFSET) * (ring4Outer - 2))
      .attr("y2", a => -Math.cos(a + FAN_OFFSET) * (ring4Outer - 2))
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.8)
      .attr("pointer-events", "none");
  }

  // ── Arc labels ──────────────────────────────────────────────────────────────
  // Only label nodes with a large enough angular span to be readable.
  // Outer rings (depth ≥ 3) use a tighter threshold because their arcs are shorter.
  const labelNodes = root.descendants().filter(d => {
    if (d.depth === 0) return false;
    if (d.depth > 4)  return false;
    const angle = d.x1 - d.x0;
    return d.depth >= 3 ? angle > 0.03 : angle > 0.05;
  });

  // Unique prefix for <path> ids so multiple sunbursts on the same page don't collide.
  const labelIdBase = `arc-label-${Math.random().toString(36).slice(2, 10)}`;
  const labelDefs   = svg.append("defs");
  const labelLayer  = g.append("g").attr("class", "arc-label-layer");

  // Build a clockwise arc path from angle a0 to a1 at radius r.
  // All paths go clockwise (sweep-flag=1) so text always reads left-to-right.
  function arcPathD(r, a0, a1) {
    const x0 = Math.sin(a0) * r, y0 = -Math.cos(a0) * r;
    const x1 = Math.sin(a1) * r, y1 = -Math.cos(a1) * r;
    return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`;
  }

  function wrapTextToLines(text, charsPerLine) {
    const words = text.split(/\s+/);

    const lines = [];
    let current = "";
    words.forEach(w => {
      const test = current ? `${current} ${w}` : w;
      if (test.length > charsPerLine && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    });
    if (current) lines.push(current);
    return lines;
  }

  function estimateLineWidth(line, fontSize) {
    return (line || "").length * fontSize * 0.56;
  }

  function blockItemsToLines(items, charsPerLine, prefix = "") {
    const lines = [];
    (items || []).forEach(item => {
      const wrapped = wrapTextToLines(item, charsPerLine);
      if (wrapped.length === 0) return;
      wrapped.forEach((line, index) => {
        lines.push(index === 0 && prefix ? `${prefix} ${line}` : line);
      });
    });
    return lines;
  }

  function hasWordLongerThan(text, charsPerLine) {
    return text.split(/\s+/).some(w => w.length > charsPerLine);
  }

  // Because every risk has its own bestpractice-block / checklist-block child,
  // there would be one label per risk in those outer rings.
  // Instead we pick just the widest arc segment per subcategory and label that one,
  // effectively giving one label per subcategory division.
  const preferredBlockLabelNode = new Map();
  // Count depth-2 nodes to decide whether risk labels should be curved or angled.
  const totalRiskSegments = root.descendants().filter(n => n.depth === 2).length;
  labelNodes.forEach(d => {
    if (d.data.type !== "bestpractice-block" && d.data.type !== "checklist-block") return;
    const subcat    = d.ancestors().find(a => a.depth === 1);
    const subcatName = subcat?.data?.name || "";
    const key       = `${d.data.type}::${subcatName}`;
    const current   = preferredBlockLabelNode.get(key);
    if (!current || (d.x1 - d.x0) > (current.x1 - current.x0)) {
      preferredBlockLabelNode.set(key, d);
    }
  });

  labelNodes.forEach((d, i) => {
    if (d.data.type === "bestpractice-block" || d.data.type === "checklist-block") {
      const subcat = d.ancestors().find(a => a.depth === 1);
      const subcatName = subcat?.data?.name || "";
      const key = `${d.data.type}::${subcatName}`;
      if (preferredBlockLabelNode.get(key) !== d) return;
    }

    const isBlockLabel = d.data.type === "bestpractice-block" || d.data.type === "checklist-block";
    const parentSubcategory = isBlockLabel ? d.ancestors().find(a => a.depth === 1) : null;
    const blockLines = isBlockLabel
      ? (d.data.content || []).map(t => getEntryShortLabel(t).trim()).filter(Boolean)
      : [];

    const rawText = d.data.type === "bestpractice-block"
      ? (blockLines.join(" • ") || "Best Practices")
      : d.data.type === "checklist-block"
        ? (blockLines.join(" • ") || "Checklist")
        : (d.data.shortLabel || d.data.short_label || d.data.name);

    const ringH = Math.max(4, d.y1 - d.y0 - 2);
    const labelX0 = isBlockLabel && parentSubcategory ? parentSubcategory.x0 : d.x0;
    const labelX1 = isBlockLabel && parentSubcategory ? parentSubcategory.x1 : d.x1;
    const a0 = labelX0 + FAN_OFFSET;
    const a1 = labelX1 + FAN_OFFSET;
    const angle = Math.max(0.01, labelX1 - labelX0);
    const midR = (d.y0 + d.y1) / 2;
    const isPriorityRing = d.depth === 1 || d.depth === 2;
    const ringArcLen = midR * angle;
    const aMid = (a0 + a1) / 2;
    const isRightSide = Math.sin(aMid) > 0;
    const useCurvedRiskLabel = d.depth === 2 && totalRiskSegments <= 2;
    const subcategoryMatchText = `${d.data?.name || ""} ${d.data?.shortLabel || d.data?.short_label || ""}`.toLowerCase();
    const isMisrepresentationSubcategory = d.depth === 1 && (
      subcategoryMatchText.includes("misrepresentation") ||
      subcategoryMatchText.includes("underrepresentation") ||
      subcategoryMatchText.includes("context loss") ||
      subcategoryMatchText.includes("loss of context")
    );
    // Narrow right-side subcategory arcs can't fit a curved label comfortably;
    // flag them so we can fall back to a compact horizontal label instead.
    const smallPriorityRingBox = isPriorityRing && isRightSide &&
      (d.depth === 1 && ringArcLen < 195 && angle < 0.34);

    const baseFontSize = d.depth === 1
      ? (smallPriorityRingBox ? 7 : 12)
      : d.depth === 2
        ? (smallPriorityRingBox ? 6.5 : 11)
        : d.depth === 3 ? 11 : 12;

    // Auto-shrink is only applied to the subcategory ring (depth 1) and only when
    // the segment is wide enough to benefit. Inner rings use fixed sizes.
    const shouldAutoShrink = !smallPriorityRingBox && d.depth === 1;
    const minFontSize = d.depth === 1 ? 4.2 : d.depth === 2 ? 4.3 : 4.8;
    const autoShrinkMinFont = d.depth === 1
      ? Math.max(minFontSize, baseFontSize - 2)
      : minFontSize;

    const blockPrefix = d.depth === 3 ? "📌" : d.depth === 4 ? "✓" : "";

    let fontSize = baseFontSize;
    const lineHeightMult = d.depth === 2 ? 0.9 : (isBlockLabel ? 1.2 : 1.14);
    let lineH = fontSize * lineHeightMult;
    let maxLines = Math.max(1, Math.floor((ringH * 1.0) / lineH));
    let arcLen = Math.max(8, (d.depth >= 3 ? (d.y0 + 2) : midR) * angle * 1.05);
    let charsPerLine = Math.max(3, Math.floor(arcLen / (fontSize * 0.56)));
    let lines = (isBlockLabel && blockLines.length)
      ? blockItemsToLines(blockLines, charsPerLine, blockPrefix)
      : wrapTextToLines(rawText, charsPerLine);

    // For risk ring, reduce font if wrapping exceeds 4 lines,
    // but keep it close to the base size.
    const riskWrapMinFont = d.depth === 2
      ? Math.max(minFontSize, baseFontSize - 1.5)
      : minFontSize;
    while (d.depth === 2 && lines.length > 4 && fontSize - 0.5 >= riskWrapMinFont) {
      fontSize -= 0.5;
      lineH = fontSize * lineHeightMult;
      maxLines = Math.max(1, Math.floor((ringH * 1.0) / lineH));
      charsPerLine = Math.max(3, Math.floor(arcLen / (fontSize * 0.56)));
      lines = wrapTextToLines(rawText, charsPerLine);
    }

    const linesFitWidth = () => lines.every(line => estimateLineWidth(line, fontSize) <= arcLen);

    while (
      shouldAutoShrink &&
      (
        lines.length > maxLines ||
        (isBlockLabel && blockLines.length
          ? lines.some(line => hasWordLongerThan(line, charsPerLine))
          : hasWordLongerThan(rawText, charsPerLine)) ||
        !linesFitWidth()
      ) &&
      fontSize - 0.5 >= autoShrinkMinFont
    ) {
      fontSize -= 0.5;
      lineH = fontSize * lineHeightMult;
      maxLines = Math.max(1, Math.floor((ringH * 0.9) / lineH));
      charsPerLine = Math.max(3, Math.floor(arcLen / (fontSize * 0.56)));
      lines = (isBlockLabel && blockLines.length)
        ? blockItemsToLines(blockLines, charsPerLine, blockPrefix)
        : wrapTextToLines(rawText, charsPerLine);
    }

    const wasTruncated = lines.length > maxLines;
    if (wasTruncated) {
      if (d.depth !== 2) {
        fontSize = Math.max(minFontSize, fontSize - (d.depth === 1 ? 1 : 2));
      }
      lineH = fontSize * (d.depth === 2 ? 0.86 : (isBlockLabel ? 1.08 : 1.04));
      maxLines = Math.max(1, Math.floor((ringH * 1.0) / lineH));
      charsPerLine = Math.max(3, Math.floor(arcLen / (fontSize * 0.56)));
      lines = (isBlockLabel && blockLines.length)
        ? blockItemsToLines(blockLines, charsPerLine, blockPrefix)
        : wrapTextToLines(rawText, charsPerLine);
    }

    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      const last = maxLines - 1;
      lines[last] = lines[last] + "…";
    }

    // Risk ring (depth 2): use angled straight text rotated to follow the segment's
    // radial direction. This reads more naturally than curved text for short arcs.
    // Exception: when a subcategory has only 1–2 risks the arc is wide enough for
    // a proper curved textPath, which looks better.
    if (d.depth === 2 && !useCurvedRiskLabel) {
      const riskDegAbs = (aMid * 180 / Math.PI);
      const riskX = Math.sin(aMid) * midR;
      const riskY = -Math.cos(aMid) * midR;
      const riskTextAngle = (riskDegAbs - 90) + (!isRightSide ? 180 : 0);
      const riskTransform = `translate(${riskX.toFixed(2)},${riskY.toFixed(2)}) rotate(${riskTextAngle.toFixed(2)})`;

      const textEl = labelLayer.append("text")
        .attr("class", "arc-label")
        .attr("transform", riskTransform)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", fontSize)
        .attr("fill", "#fff")
        .attr("pointer-events", "none");

      const centerLine = (lines.length - 1) / 2;
      lines.forEach((line, li) => {
        textEl.append("tspan")
          .attr("x", 0)
          .attr("y", `${(li - centerLine) * lineH}px`)
          .text(line);
      });

      return;
    }

    // Some subcategory names (misrepresentation, context loss, etc.) have long words
    // that look better as angled straight text rather than following the tight arc.
    // We detect these by checking the combined name + shortLabel string.
    if (isMisrepresentationSubcategory) {
      const subDegAbs = (aMid * 180 / Math.PI);
      const subX = Math.sin(aMid) * midR;
      const subY = -Math.cos(aMid) * midR;
      const subTextAngle = (subDegAbs - 90) + (!isRightSide ? 180 : 0);

      const textEl = labelLayer.append("text")
        .attr("class", "arc-label")
        .attr("transform", `translate(${subX.toFixed(2)},${subY.toFixed(2)}) rotate(${subTextAngle.toFixed(2)})`)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", fontSize)
        .attr("fill", "#fff")
        .attr("pointer-events", "none");

      const centerLine = (lines.length - 1) / 2;
      lines.forEach((line, li) => {
        textEl.append("tspan")
          .attr("x", 0)
          .attr("y", `${(li - centerLine) * lineH}px`)
          .text(line);
      });

      return;
    }

    // For narrow right-side subcategory arcs: render a near-horizontal label
    // with a slight tilt instead of curving it along the tight arc.
    if (smallPriorityRingBox) {
      const x = Math.sin(aMid) * midR;
      const y = -Math.cos(aMid) * midR;
      const hFontSize = baseFontSize;
      const tiltDeg = Math.max(-12, Math.min(12, -(aMid * 180 / Math.PI) * 0.25));

      const textEl = labelLayer.append("text")
        .attr("class", "arc-label")
        .attr("transform", `translate(${x},${y}) rotate(${tiltDeg})`)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", hFontSize)
        .attr("fill", d.depth <= 2 ? "#fff" : "#333")
        .attr("pointer-events", "none");

      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", "0px")
        .text(rawText);

      return;
    }

    // Default rendering path: one <textPath> arc per wrapped line, stacked radially.
    // Each line gets its own <path> in <defs> at a slightly different radius so lines
    // are evenly centred within the ring height.
    const totalH = (lines.length - 1) * lineH;
    lines.forEach((line, li) => {
      const offset = totalH / 2 - li * lineH;
      const isOuterTextRing = d.depth === 3 || d.depth === 4;
      const isOuterEdgeLabel = isOuterTextRing && Math.abs(Math.sin(aMid)) > 0.9;
      const innerTextPad = isOuterTextRing ? 3 : 2;
      const outerTextPad = isOuterTextRing ? (isOuterEdgeLabel ? 12 : 8) : 2;
      const minR = d.y0 + innerTextPad;
      const maxR = Math.max(minR, d.y1 - outerTextPad);
      const r = Math.max(minR, Math.min(maxR, ((d.y0 + d.y1) / 2) + offset));
      const pathId = `${labelIdBase}-${i}-${li}`;

      labelDefs.append("path")
        .attr("id", pathId)
        .attr("d", arcPathD(r, a0, a1));

      const textEl = labelLayer.append("text")
        .attr("class", "arc-label")
        .attr("text-anchor", "middle")
        .attr("font-size", fontSize)
        .attr("fill", d.depth <= 2 ? "#fff" : "#333")
        .attr("pointer-events", "none");

      textEl.append("textPath")
        .attr("href", `#${pathId}`)
        .attr("startOffset", "50%")
        .text(line);
    });
  });

  // Centre label — sits just above the fan origin, max 2 lines.
  const centerLabel = g.append("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "auto")
    .attr("y", -10)
    .attr("font-size", 11)
    .attr("fill", "#666");

  const rootCharsPerLine = 18;
  const rootLines = wrapTextToLines(rootData.name || "", rootCharsPerLine);
  const shownRootLines = rootLines.slice(0, 2);
  if (rootLines.length > 2) {
    shownRootLines[1] = shownRootLines[1].slice(0, Math.max(2, rootCharsPerLine - 1)) + "…";
  }

  const rootLineHeight = 12;
  const rootTotalHeight = (shownRootLines.length - 1) * rootLineHeight;
  shownRootLines.forEach((line, i) => {
    centerLabel.append("tspan")
      .attr("x", 0)
      .attr("dy", i === 0 ? `${-rootTotalHeight / 2}px` : `${rootLineHeight}px`)
      .text(line);
  });

  return svg.node();
}

// Serialise the SVG DOM node to an .svg file and trigger a browser download.
function exportSVG(svgNode, filename) {
  const serializer = new XMLSerializer();
  const src = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(svgNode);
  const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Render the SVG to an off-screen <canvas> at 4× scale for sharpness, then
// encode as JPEG and trigger a download. Falls back with an alert on failure.
function exportJPEG(svgNode, filename, quality = 0.96, scale = 4) {
  const serializer = new XMLSerializer();
  const clone = svgNode.cloneNode(true);
  if (!clone.getAttribute("xmlns")) {
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!clone.getAttribute("xmlns:xlink")) {
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  const src = '<?xml version="1.0" encoding="UTF-8"?>\n' + serializer.serializeToString(clone);
  const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const width = Number(svgNode.getAttribute("width")) || 1200;
  const height = Number(svgNode.getAttribute("height")) || 800;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(url);
    return;
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const img = new Image();
  img.onload = () => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const jpgUrl = canvas.toDataURL("image/jpeg", quality);
    const a = document.createElement("a");
    a.href = jpgUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  img.onerror = () => {
    URL.revokeObjectURL(url);
    alert("Failed to export JPEG. Please try Export SVG.");
  };

  img.src = url;
}

// Walk the hierarchy under a section node and collect, per subcategory:
//   • risk names  (for context in the checklist panel)
//   • best-practice strings  (de-duplicated across risks)
//   • checklist strings  (de-duplicated across risks)
// Returns an array of { name, risks, bestPractices, checks } objects,
// filtered to subcategories that have at least one item.
function collectChecklistBySubcategory(sectionNode) {
  return (sectionNode.children || []).map(subcat => {
    const checks = new Set();
    const risks = [];
    const bestPractices = new Set();

    (subcat.children || []).forEach(risk => {
      risks.push(risk.name);
      const bpBlock = (risk.children || []).find(ch => ch.type === "bestpractice-block");
      (bpBlock?.content || []).forEach(bp => bestPractices.add(getEntryName(bp)));
      (risk.checklist || []).forEach(item => checks.add(getEntryName(item)));
    });

    return {
      name: subcat.name,
      risks,
      bestPractices: [...bestPractices],
      checks: [...checks]
    };
  }).filter(sc => sc.risks.length > 0 || sc.bestPractices.length > 0 || sc.checks.length > 0);
}

// Build the collapsible HTML checklist panel shown below each sunburst.
// Each subcategory becomes a <details> block; clicking the summary expands
// the list of risks, best practices, and checklist items for that subcategory.
function createChecklistPanel(sectionNode) {
  const wrap = document.createElement("div");
  wrap.className = "checklist-wrap";

  const title = document.createElement("h3");
  title.textContent = "Checklist";
  wrap.appendChild(title);

  const bySubcategory = collectChecklistBySubcategory(sectionNode);
  if (bySubcategory.length === 0) {
    const empty = document.createElement("p");
    empty.style.fontSize = "0.86rem";
    empty.style.color = "#666";
    empty.textContent = "No checklist items available in this section.";
    wrap.appendChild(empty);
    return wrap;
  }

  bySubcategory.forEach(sc => {
    const block = document.createElement("details");
    block.className = "check-block";
    block.open = false;

    const title = document.createElement("summary");
    title.className = "check-title";
    title.textContent = `${sc.name} (${sc.checks.length} checks)`;
    block.appendChild(title);

    const content = document.createElement("div");
    content.className = "check-content";

    if (sc.risks.length) {
      const riskTitle = document.createElement("h4");
      riskTitle.style.margin = "0.6rem 0.8rem 0.2rem";
      riskTitle.style.fontSize = "0.82rem";
      riskTitle.style.color = "#8a5d00";
      riskTitle.textContent = "Risks";
      content.appendChild(riskTitle);

      const riskList = document.createElement("ul");
      sc.risks.forEach(item => {
        const li = document.createElement("li");
        li.textContent = `• ${item}`;
        riskList.appendChild(li);
      });
      content.appendChild(riskList);
    }

    if (sc.bestPractices.length) {
      const bpTitle = document.createElement("h4");
      bpTitle.style.margin = "0.4rem 0.8rem 0.2rem";
      bpTitle.style.fontSize = "0.82rem";
      bpTitle.style.color = "#2f7a44";
      bpTitle.textContent = "Best Practices";
      content.appendChild(bpTitle);

      const bpList = document.createElement("ul");
      sc.bestPractices.forEach(item => {
        const li = document.createElement("li");
        li.textContent = `• ${item}`;
        bpList.appendChild(li);
      });
      content.appendChild(bpList);
    }

    const ul = document.createElement("ul");
    sc.checks.forEach(item => {
      const li = document.createElement("li");
      li.textContent = `✓ ${item}`;
      ul.appendChild(li);
    });
    content.appendChild(ul);
    block.appendChild(content);
    wrap.appendChild(block);
  });

  return wrap;
}

// Load the data, then create one card per top-level category.
// Each card contains: colour header → sunburst SVG → checklist panel → export buttons.
loadData()
  .then(data => {
    const grid = document.getElementById("grid");
    data.children.forEach(category => {
      const card = document.createElement("div");
      card.className = "card";

      // Header
      const cardHeader = document.createElement("div");
      cardHeader.className = "card-header";
      const swatch = document.createElement("div");
      swatch.className = "swatch";
      swatch.style.background = category.color;
      const h2 = document.createElement("h2");
      h2.textContent = category.name;
      cardHeader.appendChild(swatch);
      cardHeader.appendChild(h2);

      // Body
      const cardBody = document.createElement("div");
      cardBody.className = "card-body";

      // Build sub-hierarchy rooted at this category
      const subRoot = { name: category.name, color: category.color, children: category.children };
      const svgNode = buildSunburst(subRoot, cardBody);
      cardBody.appendChild(svgNode);

      const checklistPanel = createChecklistPanel(category);
      cardBody.appendChild(checklistPanel);

      // Export buttons
      const exportActions = document.createElement("div");
      exportActions.className = "export-actions";

      const svgBtn = document.createElement("button");
      svgBtn.className = "export-btn";
      svgBtn.textContent = "⬇ Export SVG";
      svgBtn.addEventListener("click", () => {
        exportSVG(svgNode, `sunburst_${category.name.replace(/[^a-z0-9]/gi,"_")}.svg`);
      });

      const jpegBtn = document.createElement("button");
      jpegBtn.className = "export-btn";
      jpegBtn.textContent = "⬇ Export JPEG";
      jpegBtn.addEventListener("click", () => {
        exportJPEG(svgNode, `sunburst_${category.name.replace(/[^a-z0-9]/gi,"_")}.jpg`);
      });

      exportActions.appendChild(svgBtn);
      exportActions.appendChild(jpegBtn);
      cardBody.appendChild(exportActions);

      card.appendChild(cardHeader);
      card.appendChild(cardBody);
      grid.appendChild(card);
    });
  })
  .catch(err => {
    document.getElementById("grid").innerHTML =
      `<p style="padding:2rem;color:red;">Failed to load data: ${err.message}. ` +
      `Ensure <code>data/heritage_checklist.js</code> loads and defines <code>window.HERITAGE_DATA</code>.</p>`;
  });
