import hrvSvg from "./assets/card.svg?raw";

const FLOW_PATH_IDS = ["path10", "path11"] as const;

/**
 * Parse the SVG string once at module load and cache the resulting element.
 * Every card instance clones this node rather than re-parsing the string.
 */
const svgTemplate = ((): SVGSVGElement => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(hrvSvg, "image/svg+xml");
  return doc.querySelector("svg") as SVGSVGElement;
})();

export function cloneCardSvg(): SVGSVGElement {
  return svgTemplate.cloneNode(true) as SVGSVGElement;
}

export function queryFlowPaths(
  svg: SVGSVGElement
): [SVGPathElement, SVGPathElement] | undefined {
  const path1 = svg.querySelector<SVGPathElement>(`#${FLOW_PATH_IDS[0]}`);
  const path2 = svg.querySelector<SVGPathElement>(`#${FLOW_PATH_IDS[1]}`);
  return path1 && path2 ? [path1, path2] : undefined;
}

export function queryMaskElement(
  svg: SVGSVGElement
): SVGPathElement | undefined {
  return (
    svg.querySelector<SVGPathElement>('#curveMask path[fill="#000000"]') ??
    undefined
  );
}
