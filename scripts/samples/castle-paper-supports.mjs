/** 城の前景にある実紙の壁・柵を支える構造。演出の有無から支持を生成しない。 */
export const CASTLE_PAPER_SUPPORTS = [
  {
    "id": "back-left-5-anchor",
    "x": -5.598,
    "z": -2.089761539,
    "width": 1.7004,
    "parent": "castle-forest",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "back-right-5-anchor",
    "x": 5.152,
    "z": -2.050741594,
    "width": 1.6152,
    "parent": "castle-forest",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "back-left-6-anchor",
    "x": -6.5,
    "z": -1.968676313,
    "width": 0.6317999999999999,
    "parent": "back-left-5-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0.094686345
  },
  {
    "id": "back-right-6-anchor",
    "x": 6.35,
    "z": -1.955553013,
    "width": 1.3361999999999998,
    "parent": "back-right-5-anchor",
    "supportHeight": 0.1,
    "supportOffset": -0.437555017
  },
  {
    "id": "back-right-1-anchor",
    "x": 1.2,
    "z": -1.604986396,
    "width": 1.4946,
    "parent": "castle-forest",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "back-left-4-anchor",
    "x": -4.45,
    "z": -1.589324553,
    "width": 1.389,
    "parent": "back-left-5-anchor",
    "supportHeight": 0.1,
    "supportOffset": -0.397057471
  },
  {
    "id": "back-left-2-anchor",
    "x": -2.148,
    "z": -1.48792565,
    "width": 1.4231999999999998,
    "parent": "castle-forest",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "back-right-2-anchor",
    "x": 1.7,
    "z": -1.448730728,
    "width": 1.473,
    "parent": "back-right-1-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "mid-left-5-anchor",
    "x": -6.5,
    "z": -0.968676313,
    "width": 1.6254,
    "parent": "back-left-6-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "mid-right-5-anchor",
    "x": 6.049999999,
    "z": -0.829306414,
    "width": 1.1514,
    "parent": "back-right-6-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "central-twin-anchor",
    "x": 2.5,
    "z": -0.818721658,
    "width": 1.8,
    "parent": "back-right-2-anchor",
    "supportHeight": 0.1,
    "supportOffset": -0.06555685
  },
  {
    "id": "mid-left-4-anchor",
    "x": -5.2,
    "z": -0.65494105,
    "width": 0.9138,
    "parent": "back-left-4-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0.25
  },
  {
    "id": "mid-left-1-anchor",
    "x": -1.55,
    "z": -0.635607428,
    "width": 1.794,
    "parent": "back-left-2-anchor",
    "supportHeight": 0.1,
    "supportOffset": -0.018418857
  },
  {
    "id": "mid-left-2-anchor",
    "x": -2.8,
    "z": -0.544968258,
    "width": 1.377,
    "parent": "mid-left-1-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0.400353649
  },
  {
    "id": "mid-right-1-anchor",
    "x": 1.6,
    "z": -0.539981862,
    "width": 1.6139999999999999,
    "parent": "central-twin-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0.080879003
  },
  {
    "id": "mid-right-4-anchor",
    "x": 4.718,
    "z": -0.512771515,
    "width": 0.522,
    "parent": "back-right-5-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0.1
  },
  {
    "id": "mid-right-2-anchor",
    "x": 2.35,
    "z": -0.40559836,
    "width": 1.377,
    "parent": "mid-right-1-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "near-left-5-anchor",
    "x": -6.412999999,
    "z": 0.238935201,
    "width": 0.3,
    "parent": "mid-left-5-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "near-left-4-anchor",
    "x": -5.1,
    "z": 0.553807816,
    "width": 0.6257999999999999,
    "parent": "mid-left-4-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "near-right-4-anchor",
    "x": 4.65,
    "z": 0.593177714,
    "width": 0.6257999999999999,
    "parent": "mid-right-4-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "near-left-2-anchor",
    "x": -2.599999999,
    "z": 0.672529475,
    "width": 0.8687999999999999,
    "parent": "mid-left-2-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "near-right-2-anchor",
    "x": 2.149999999,
    "z": 0.711899374,
    "width": 1.0038,
    "parent": "mid-right-2-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  },
  {
    "id": "bat-swarm-anchor",
    "x": 2.3,
    "z": 0.898776074,
    "width": 1.8,
    "parent": "near-right-2-anchor",
    "supportHeight": 0.1,
    "supportOffset": 0
  }
]
