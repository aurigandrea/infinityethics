const DATA_URL = "data/heritage_checklist.json";
const W = 760, H = 760, RADIUS = Math.min(W, H) / 2 - 14;

function getEntryName(entry) {
  if (typeof entry === "string") return entry;
  return entry?.name || entry?.label || entry?.text || entry?.short_label || entry?.shortLabel || entry?.short || "";
}

function getEntryShortLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry?.short_label || entry?.shortLabel || entry?.short || entry?.name || entry?.label || entry?.text || "";
}

function normalizeData(raw) {
  if (raw && Array.isArray(raw.children)) return raw;

  if (raw && Array.isArray(raw.sections)) {
    const palette = ["#f78da7", "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#00d084", "#8ed1fc", "#0693e3", "#9b51e0"];

    const getEntryText = entry => ({
      name: getEntryName(entry),
      shortLabel: getEntryShortLabel(entry)
    });

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
                    name: "Best Practices",
                    type: "bestpractice-block",
                    value: 1,
                    content: sc.best_practices || [],
                    checklist: sc.checks || [],
                    children: [
                      {
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
  return fetch(DATA_URL)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(() => {
      if (window.HERITAGE_DATA) return window.HERITAGE_DATA;
      throw new Error("Could not load JSON and no fallback global data found");
    })
    .then(normalizeData);
}

const tooltip = document.getElementById("tooltip");

function showTip(event, html) {
  tooltip.style.opacity = 1;
  tooltip.innerHTML = html;
  moveTip(event);
}
function moveTip(event) {
  tooltip.style.left = (event.clientX + 14) + "px";
  tooltip.style.top  = (event.clientY - 28) + "px";
}
function hideTip() { tooltip.style.opacity = 0; }

// ── Colour helpers ──────────────────────────────────────────────
function lighten(hex, amount) {
  let r = parseInt(hex.slice(1,3), 16);
  let g = parseInt(hex.slice(3,5), 16);
  let b = parseInt(hex.slice(5,7), 16);
  r = Math.round(r + (255-r) * amount);
  g = Math.round(g + (255-g) * amount);
  b = Math.round(b + (255-b) * amount);
  return `rgb(${r},${g},${b})`;
}

function getCategoryColor(node) {
  let n = node;
  while (n.depth > 1) n = n.parent;
  return n.data.color || "#888";
}

function fillColor(d) {
  const base = getCategoryColor(d);
  if (d.data.type === "risk") return "#8ed1fc";
  if (d.data.type === "bestpractice-block") return "#fcb900";
  if (d.data.type === "checklist-block") return "#7bdcb5";
  switch (d.depth) {
    case 1: return base;
    case 2: return "#9b51e0";
    default: return "#9b51e0";
  }
}

function nodeLabel(d) {
  if (d.data.type === "risk") return "Risk";
  if (d.data.type === "bestpractice-block") return "Best Practices";
  if (d.data.type === "checklist-block") return "Checklist";
  return ["", "Section", "Subcategory", "Risk", "Best Practices", "Checklist"][d.depth] || "Item";
}

function getBestPracticeBlockForRisk(riskNode) {
  return (riskNode.children || []).find(ch => ch.data?.type === "bestpractice-block") || null;
}

function getBestPracticesForRisk(riskNode) {
  return getBestPracticeBlockForRisk(riskNode)?.data?.content || [];
}

function getChecklistForRisk(riskNode) {
  const block = getBestPracticeBlockForRisk(riskNode);
  return block?.data?.checklist || block?.children?.[0]?.data?.content || riskNode.data?.checklist || [];
}

// ── State ────────────────────────────────────────────────────────
// checkedRisks: Map<riskNodeKey, {riskNode, pathElements}>
const checkedRisks = new Map();

// We use node.data.name + ancestors path as key
function nodeKey(d) {
  return d.ancestors().map(a => a.data.name).reverse().join("|");
}

function getSelectedSubcategoryGroups() {
  const groups = [];
  const byKey = new Map();

  checkedRisks.forEach(({ riskNode }, riskKey) => {
    const subcategoryNode = riskNode.parent;
    if (!subcategoryNode) return;

    const groupKey = nodeKey(subcategoryNode);
    let group = byKey.get(groupKey);

    if (!group) {
      const categoryNode = subcategoryNode.parent;
      group = {
        key: groupKey,
        path: categoryNode?.data?.name || "",
        subcategoryName: subcategoryNode.data.name,
        riskKeys: [],
        risks: [],
        bestPractices: [],
        checks: [],
        _bpSet: new Set(),
        _checkSet: new Set()
      };
      byKey.set(groupKey, group);
      groups.push(group);
    }

    group.riskKeys.push(riskKey);
    group.risks.push(riskNode.data.name);

    getBestPracticesForRisk(riskNode).forEach(bp => {
      const label = getEntryName(bp);
      if (label && !group._bpSet.has(label)) {
        group._bpSet.add(label);
        group.bestPractices.push(label);
      }
    });

    getChecklistForRisk(riskNode).forEach(item => {
      const label = getEntryName(item);
      if (label && !group._checkSet.has(label)) {
        group._checkSet.add(label);
        group.checks.push(label);
      }
    });
  });

  return groups.map(({ _bpSet, _checkSet, ...group }) => group);
}

// ── Checklist panel rendering ────────────────────────────────────
function renderChecklistPanel() {
  const body = document.getElementById("checklist-body");
  const empty = document.getElementById("checklist-empty");
  const groups = getSelectedSubcategoryGroups();

  if (groups.length === 0) {
    empty.style.display = "block";
    // remove all sections
    body.querySelectorAll(".risk-section").forEach(el => el.remove());
    return;
  }

  empty.style.display = "none";

  // Build set of currently rendered sections
  const existingKeys = new Set(
    [...body.querySelectorAll(".risk-section")].map(el => el.dataset.key)
  );

  // Remove unticked sections
  body.querySelectorAll(".risk-section").forEach(el => {
    if (!groups.some(group => group.key === el.dataset.key)) el.remove();
  });

  // Add new sections (maintain order)
  groups.forEach(group => {
    const key = group.key;
    if (existingKeys.has(key)) return;

    const section = document.createElement("div");
    section.className = "risk-section checked";
    section.dataset.key = key;

    // Risk header
    const header = document.createElement("div");
    header.className = "risk-header";
    header.innerHTML = `
      <div class="risk-toggle">✓</div>
      <div>
        <div class="risk-label">${group.subcategoryName}</div>
        <span class="risk-path">${group.path} · ${group.risks.length} selected risk${group.risks.length === 1 ? "" : "s"}</span>
      </div>
    `;
    header.addEventListener("click", () => toggleSubcategoryGroup(group.riskKeys, section));

    // Checklist area
    const checklistDiv = document.createElement("div");
    checklistDiv.className = "risk-checklist";

    const selectedRiskLabel = document.createElement("span");
    selectedRiskLabel.className = "bp-label";
    selectedRiskLabel.textContent = "Selected Risks";
    checklistDiv.appendChild(selectedRiskLabel);

    const selectedRiskList = document.createElement("ul");
    group.risks.forEach(item => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="check-icon">•</span><span>${item}</span>`;
      selectedRiskList.appendChild(li);
    });
    checklistDiv.appendChild(selectedRiskList);

    if (group.bestPractices.length) {
      const bpLabel = document.createElement("span");
      bpLabel.className = "bp-label";
      bpLabel.textContent = "Best Practices";
      checklistDiv.appendChild(bpLabel);

      const bpList = document.createElement("ul");
      group.bestPractices.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="check-icon">📌</span><span>${item}</span>`;
        bpList.appendChild(li);
      });
      checklistDiv.appendChild(bpList);
    }

    if (group.checks.length) {
      const checkLabel = document.createElement("span");
      checkLabel.className = "bp-label";
      checkLabel.textContent = "Checklist";
      checklistDiv.appendChild(checkLabel);

      const ul = document.createElement("ul");
      group.checks.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="check-icon">✓</span><span>${item}</span>`;
        ul.appendChild(li);
      });
      checklistDiv.appendChild(ul);
    }

    section.appendChild(header);
    section.appendChild(checklistDiv);
    body.insertBefore(section, empty);
  });
}

// Toggle a whole selected subcategory group off from the checklist panel header click
function toggleSubcategoryGroup(riskKeys, sectionEl) {
  riskKeys.forEach(key => checkedRisks.delete(key));
  sectionEl.remove();

  updateSunburstHighlight();
  renderChecklistPanel();
}

// ── Sunburst path reference map ──────────────────────────────────
const pathByKey = new Map();  // key → SVG path element

function updateSunburstHighlight() {
  pathByKey.forEach((pathEl, key) => {
    const isChecked = checkedRisks.has(key);
    d3.select(pathEl).classed("checked-risk", isChecked);
  });

  // Dim non-checked risks if any are checked
  const anyChecked = checkedRisks.size > 0;
  d3.selectAll("path[data-risk='1']").each(function(d) {
    const key = nodeKey(d);
    const isChecked = checkedRisks.has(key);
    d3.select(this)
      .style("opacity", anyChecked ? (isChecked ? 1 : 0.4) : 1)
      .attr("stroke-width", isChecked ? 2 : 0.5)
      .attr("stroke", isChecked ? "#fff" : "#fff");
  });
}

// ── Export functions ─────────────────────────────────────────────
document.getElementById("btnExportText").addEventListener("click", () => {
  if (checkedRisks.size === 0) {
    alert("No risks selected. Please tick at least one risk first.");
    return;
  }
  const groups = getSelectedSubcategoryGroups();
  let text = "DIGITAL HERITAGE ETHICS – SELECTED RISK CHECKLIST\n";
  text += "=".repeat(50) + "\n\n";

  groups.forEach(group => {
    text += `SUBCATEGORY: ${group.subcategoryName}\n`;
    text += `PATH: ${group.path}\n`;
    text += "-".repeat(40) + "\n";

    text += "  Selected Risks:\n";
    group.risks.forEach(item => {
      text += `    • ${item}\n`;
    });

    if (group.bestPractices.length) {
      text += "  Best Practices:\n";
      group.bestPractices.forEach(item => {
        text += `    📌 ${item}\n`;
      });
    }

    if (group.checks.length) {
      text += "  Checklist:\n";
      group.checks.forEach(item => {
        text += `    ✓ ${item}\n`;
      });
    }

    text += "\n";
  });

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "digital_heritage_checklist.txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById("btnExportHTML").addEventListener("click", () => {
  if (checkedRisks.size === 0) {
    alert("No risks selected. Please tick at least one risk first.");
    return;
  }
  const groups = getSelectedSubcategoryGroups();

  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Digital Heritage Ethics – Risk Checklist Export</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; max-width: 800px; margin: 2rem auto; color: #333; }
  h1 { font-size: 1.4rem; color: #2c3e50; border-bottom: 2px solid #4e79a7; padding-bottom: 0.4rem; margin-bottom: 1.5rem; }
  .risk { margin-bottom: 1.5rem; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
  .risk-head { background: #fff8e1; padding: 0.7rem 1rem; border-bottom: 1px solid #e0e0e0; }
  .risk-head h2 { font-size: 1rem; color: #b85c00; }
  .risk-head .path { font-size: 0.75rem; color: #888; margin-top: 0.2rem; }
  .bps { padding: 0.7rem 1rem; }
  .bp-name { font-size: 0.85rem; font-style: italic; color: #4e79a7; margin: 0.5rem 0 0.3rem; font-weight: 600; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: 0.3rem 0; font-size: 0.88rem; border-bottom: 1px solid #f5f5f5; }
  li::before { content: "✓ "; color: #4caf50; font-weight: bold; }
  .footer { margin-top: 2rem; font-size: 0.75rem; color: #aaa; }
</style>
</head>
<body>
<h1>🏛 Digital Heritage Ethics – Selected Risk Checklist</h1>
<p style="font-size:0.85rem;color:#777;margin-bottom:1.5rem;">
  Generated: ${new Date().toLocaleString()} | ${checkedRisks.size} risk(s) selected
</p>
`;

  groups.forEach(group => {
    const riskItems = group.risks.map(item => `      <li>${item}</li>`).join("\n");
    const bestPracticeItems = group.bestPractices.map(item => `      <li>${item}</li>`).join("\n");
    const checklistItems = group.checks.map(item => `      <li>${item}</li>`).join("\n");

    html += `<div class="risk">
  <div class="risk-head">
    <h2>${group.subcategoryName}</h2>
    <div class="path">${group.path}</div>
  </div>
  <div class="bps">
    <div class="bp-name">Selected Risks</div>
    <ul>
${riskItems}
    </ul>
${group.bestPractices.length ? `    <div class="bp-name">Best Practices</div>
    <ul>
${bestPracticeItems}
    </ul>
` : ""}${group.checks.length ? `    <div class="bp-name">Checklist</div>
    <ul>
${checklistItems}
    </ul>
` : ""}`;

    html += `  </div>\n</div>\n`;
  });

  html += `<p class="footer">Digital Heritage Ethics Checklist – digitalheritageviz</p>\n</body>\n</html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "digital_heritage_checklist.html";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById("btnClearAll").addEventListener("click", () => {
  checkedRisks.clear();
  updateSunburstHighlight();
  renderChecklistPanel();
});

// ── Build sunburst ───────────────────────────────────────────────
loadData()
  .then(data => {
    const root = d3.hierarchy(data)
      .sum(d => {
        if (!d.children || d.children.length === 0) {
          const base = (d.name || "").length;
          const bpLen = (d.content || []).reduce((n, t) => n + getEntryName(t).length, 0);
          const checksLen = (d.checklist || []).reduce((n, t) => n + getEntryName(t).length, 0);
          const rawWeight = Math.max(1, base + bpLen * 0.35 + checksLen * 0.2);
          const compressedWeight = 22 + Math.pow(rawWeight, 0.62);
          return Math.max(1, compressedWeight);
        }
        return 0;
      })
      .sort((a, b) => b.value - a.value);

    const partition = d3.partition().size([2 * Math.PI, RADIUS]);
    partition(root);

    const maxDepth = d3.max(root.descendants(), d => d.depth) || 0;
    const depthWeights = Array.from({ length: maxDepth + 1 }, (_, depth) => {
      if (depth === 0) return 0.4;
      if (depth === 1) return 1.4;
      if (depth === 2) return 1.2;
      if (depth === 3) return 1.2;
      if (depth === 4) return 0.44;
      if (depth === 5) return 0.46;
      return 1.0;
    });

    const totalWeight = d3.sum(depthWeights);
    const depthStart = [];
    let running = 0;
    depthWeights.forEach((weight, depth) => {
      depthStart[depth] = running;
      running += weight;
    });

    root.descendants().forEach(d => {
      d.y0 = (depthStart[d.depth] / totalWeight) * RADIUS;
      d.y1 = ((depthStart[d.depth] + depthWeights[d.depth]) / totalWeight) * RADIUS;
    });

    const arc = d3.arc()
      .startAngle(d => d.x0)
      .endAngle(d => d.x1)
      .padAngle(d => d.depth >= 4 ? 0 : Math.min((d.x1 - d.x0) / 2, 0.012))
      .padRadius(RADIUS / 2)
      .innerRadius(d => d.y0)
      .outerRadius(d => d.y1 - 2);

    const svg = d3.select("#chart")
      .append("svg")
        .attr("width", W)
        .attr("height", H)
        .attr("viewBox", `0 0 ${W} ${H}`)
        .style("max-width", "100%");

    const g = svg.append("g")
      .attr("transform", `translate(${W/2},${H/2})`);

    // Draw arcs
    g.selectAll("path")
      .data(root.descendants().filter(d => d.depth > 0))
      .join("path")
        .attr("d", arc)
        .attr("fill", fillColor)
        .attr("stroke", d => d.depth >= 4 ? "none" : "#fff")
        .attr("stroke-width", d => d.depth >= 4 ? 0 : 0.5)
        .attr("data-depth", d => d.depth)
        .attr("data-risk", d => d.data.type === "risk" ? "1" : "0")
        .style("cursor", d => d.data.type === "risk" ? "pointer" : "default")
      .each(function(d) {
        // Store SVG path element by key (for risk items)
        if (d.data.type === "risk") pathByKey.set(nodeKey(d), this);
      })
      .on("mouseover", (event, d) => {
        const blockItems = d.data.type === "bestpractice-block" || d.data.type === "checklist-block"
          ? `<br>${(d.data.content || []).map(item => `• ${getEntryName(item)}`).join("<br>")}`
          : "";
        const extra = d.data.type === "risk"
          ? `<br><em style="color:#dbeafe">Click to tick this risk</em>`
          : "";
        showTip(event, `<strong>${nodeLabel(d)}:</strong><br>${d.data.name}${blockItems}${extra}`);
      })
      .on("mousemove", moveTip)
      .on("mouseleave", hideTip)
      .on("click", (event, d) => {
        if (d.data.type !== "risk") return;

        const key = nodeKey(d);
        if (checkedRisks.has(key)) {
          checkedRisks.delete(key);
        } else {
          checkedRisks.set(key, { riskNode: d });
        }
        updateSunburstHighlight();
        renderChecklistPanel();
      });

    const depth4Nodes = root.descendants().filter(d => d.depth === 4);
    const depth5Nodes = root.descendants().filter(d => d.depth === 5);
    const ring4Inner = d3.min(depth4Nodes, d => d.y0);
    const ring5Outer = d3.max(depth5Nodes.length ? depth5Nodes : depth4Nodes, d => d.y1);

    if (ring4Inner != null && ring5Outer != null) {
      const boundaryAngles = Array.from(new Set(
        root.descendants()
          .filter(d => d.depth === 2)
          .flatMap(d => [d.x0, d.x1])
          .map(a => a.toFixed(6))
      )).map(a => +a);

      g.append("g")
        .attr("class", "subcategory-boundaries")
        .selectAll("line")
        .data(boundaryAngles)
        .join("line")
        .attr("x1", a => Math.sin(a) * ring4Inner)
        .attr("y1", a => -Math.cos(a) * ring4Inner)
        .attr("x2", a => Math.sin(a) * (ring5Outer - 2))
        .attr("y2", a => -Math.cos(a) * (ring5Outer - 2))
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.8)
        .attr("pointer-events", "none");
    }

    // Labels
    g.selectAll("text.node-label")
      .data(root.descendants().filter(d => {
        if (d.depth === 0) return false;
        if (d.depth >= 4) return false;
        return (d.x1 - d.x0) > 0.04;
      }))
      .join("text")
        .attr("class", "node-label")
        .attr("transform", d => {
          const angle = (d.x0 + d.x1) / 2;
          const radius = (d.y0 + d.y1) / 2;
          const x = Math.sin(angle) * radius;
          const y = -Math.cos(angle) * radius;
          const rot = (angle * 180 / Math.PI) - 90;
          const flip = angle > Math.PI ? rot + 180 : rot;
          return `translate(${x},${y}) rotate(${flip})`;
        })
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("font-size", d => d.depth === 1 ? 10.5 : d.depth === 2 ? 8 : 7.2)
        .attr("fill", "#fff")
        .attr("pointer-events", "none")
        .each(function(d) {
          const fontSize   = d.depth === 1 ? 10.5 : d.depth === 2 ? 8 : 7.2;
          const lineHeight = d.depth === 1 ? fontSize * 1.05 : fontSize * 1.25;
          const arcSpan    = d.x1 - d.x0;
          const rMid       = (d.y0 + d.y1) / 2;
          const ringH      = d.y1 - d.y0;
          const arcLen     = arcSpan * rMid;
          const maxLines   = Math.max(1, Math.floor(ringH / lineHeight));
          const charsPerLine = Math.max(4, Math.floor(arcLen / (fontSize * 0.56)));

          const label = d.data.shortLabel || d.data.short_label || d.data.name;
          const words = label.split(" ");
          const lines = [];
          let cur = "";
          for (const w of words) {
            const candidate = cur ? cur + " " + w : w;
            if (candidate.length > charsPerLine && cur) { lines.push(cur); cur = w; }
            else cur = candidate;
          }
          if (cur) lines.push(cur);
          const display = lines.slice(0, maxLines);

          const el = d3.select(this);
          display.forEach((line, i) => {
            el.append("tspan")
              .attr("x", 0)
              .attr("dy", i === 0
                ? `${-(display.length - 1) * lineHeight / 2}px`
                : `${lineHeight}px`)
              .text(line);
          });
        });

    // Per-subcategory curved labels for depth-4 (Best Practices) and depth-5 (Checklist)
    // Group nodes by their depth-2 (subcategory) ancestor so each division gets ONE label.
    const svgDefs = g.append("defs");
    let arcLabelId = 0;

    [4, 5].forEach(targetDepth => {
      // Build a map: subcategoryNode → [nodes at targetDepth]
      const groups = new Map();
      root.descendants()
        .filter(d => d.depth === targetDepth)
        .forEach(d => {
          // Walk up to depth-2 ancestor
          let anc = d;
          while (anc && anc.depth > 2) anc = anc.parent;
          if (!anc) return;
          if (!groups.has(anc)) groups.set(anc, []);
          groups.get(anc).push(d);
        });

      groups.forEach((nodes, subcatNode) => {
        // Span the full arc of the subcategory's section in this ring
        const x0 = subcatNode.x0;
        const x1 = subcatNode.x1;
        const arcSpan = x1 - x0;
        // Use the y-range of the actual nodes
        const y0ring = nodes[0].y0;
        const y1ring = nodes[0].y1;
        const rMid   = (y0ring + y1ring) / 2;
        const arcLen = arcSpan * rMid;
        const ringH  = y1ring - y0ring;
        const fontSize   = 6;
        const lineHeight = fontSize * 1.35;
        const maxLines   = Math.max(1, Math.floor(ringH / lineHeight));
        if (arcLen < 14) return;

        // word-wrap
        const charsPerLine = Math.max(3, Math.floor(arcLen / (fontSize * 0.58)));
        const words = nodes[0].data.name.split(" ");
        const lines = [];
        let cur = "";
        for (const w of words) {
          const candidate = cur ? cur + " " + w : w;
          if (candidate.length > charsPerLine && cur) { lines.push(cur); cur = w; }
          else cur = candidate;
        }
        if (cur) lines.push(cur);
        const display = lines.slice(0, maxLines);

        const fill    = targetDepth === 4 ? "#7a5a00" : "#226b4e";

        display.forEach((line, li) => {
          const offset = (li - (display.length - 1) / 2) * lineHeight;
          const r      = rMid + offset;
          const large  = arcSpan > Math.PI ? 1 : 0;
          const id     = `arc-lbl-${arcLabelId++}`;
          // Always clockwise — text curves along the ring without flipping
          const sx = Math.sin(x0) * r, sy = -Math.cos(x0) * r;
          const ex = Math.sin(x1) * r, ey = -Math.cos(x1) * r;
          const pathD = `M ${sx},${sy} A ${r},${r} 0 ${large},1 ${ex},${ey}`;
          svgDefs.append("path").attr("id", id).attr("d", pathD);

          g.append("text")
            .attr("pointer-events", "none")
            .attr("font-size", fontSize)
            .attr("font-weight", "600")
            .attr("fill", fill)
            .attr("dominant-baseline", "middle")
            .append("textPath")
              .attr("href", `#${id}`)
              .attr("startOffset", "50%")
              .attr("text-anchor", "middle")
              .text(line);
        });
      });
    });

    // Centre
    g.append("text")
      .attr("text-anchor", "middle").attr("dy", "-0.3em")
      .attr("font-size", 9).attr("font-weight", "600").attr("fill", "#555")
      .text("Digital Heritage");
    g.append("text")
      .attr("text-anchor", "middle").attr("dy", "0.9em")
      .attr("font-size", 9).attr("fill", "#777")
      .text("Ethics");
  })
  .catch(err => {
    document.getElementById("chart").innerHTML =
      `<p style="padding:2rem;color:red;">Failed to load data: ${err.message}.<br>` +
      `Make sure <code>data/heritage_checklist.js</code> exists or serve via a local web server.</p>`;
  });
