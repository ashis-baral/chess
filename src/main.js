import { Chess } from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const PIECES = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};
const VALUES = { p: 100, n: 320, b: 335, r: 500, q: 900, k: 0 };
const files = "abcdefgh";

let game = new Chess();
let playerColor = "w";
let flipped = false;
let selectedSquare = null;
let legalTargets = [];
let thinking = false;
let redoLine = [];
let promotionResolve = null;
let toastTimer;
let aiTimer;

const $ = (selector) => document.querySelector(selector);
const boardElement = $("#board");
const historyElement = $("#move-history");
const difficultyElement = $("#difficulty");

function isGameOver() {
  return game.isGameOver();
}

function renderBoard() {
  boardElement.replaceChildren();
  const rankOrder = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const fileOrder = flipped ? [...files].reverse() : [...files];
  const checkedKing = game.isCheck() ? game.board().flat().find((piece) => piece?.type === "k" && piece.color === game.turn()) : null;

  rankOrder.forEach((rank, row) => {
    fileOrder.forEach((file, column) => {
      const squareName = `${file}${rank}`;
      const piece = game.get(squareName);
      const square = document.createElement("button");
      square.type = "button";
      square.className = `square ${(row + column) % 2 === 0 ? "light-square" : "dark-square"}`;
      square.dataset.square = squareName;
      square.setAttribute("role", "gridcell");
      square.setAttribute("aria-label", `${squareName}${piece ? `, ${piece.color === "w" ? "white" : "black"} ${piece.type}` : ""}`);
      if (selectedSquare === squareName) square.classList.add("selected-square");
      if (legalTargets.some((move) => move.to === squareName)) {
        square.classList.add(piece ? "capture-target" : "move-target");
      }
      if (game.history({ verbose: true }).at(-1)?.to === squareName || game.history({ verbose: true }).at(-1)?.from === squareName) {
        square.classList.add("last-move");
      }
      if (piece && checkedKing && piece.type === "k" && piece.color === game.turn()) square.classList.add("in-check");
      if (column === 0) square.insertAdjacentHTML("beforeend", `<span class="rank-coordinate">${rank}</span>`);
      if (row === 7) square.insertAdjacentHTML("beforeend", `<span class="file-coordinate">${file}</span>`);
      if (piece) {
        const glyph = document.createElement("span");
        glyph.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
        glyph.textContent = PIECES[piece.color][piece.type];
        square.append(glyph);
      }
      square.addEventListener("click", () => onSquareClick(squareName));
      boardElement.append(square);
    });
  });
  boardElement.setAttribute("aria-label", `${flipped ? "Flipped" : "Standard"} chess board`);
}

function onSquareClick(square) {
  if (thinking || isGameOver() || game.turn() !== playerColor) return;
  const piece = game.get(square);
  if (selectedSquare && legalTargets.some((move) => move.to === square)) {
    const move = legalTargets.find((candidate) => candidate.to === square);
    if (move.promotion) {
      showPromotionDialog(playerColor).then((promotion) => makePlayerMove(selectedSquare, square, promotion));
      return;
    }
    makePlayerMove(selectedSquare, square);
    return;
  }
  if (piece?.color === playerColor) {
    selectedSquare = square;
    legalTargets = game.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalTargets = [];
  }
  renderBoard();
}

function makePlayerMove(from, to, promotion) {
  game.move({ from, to, ...(promotion ? { promotion } : {}) });
  selectedSquare = null;
  legalTargets = [];
  redoLine = [];
  updateUI();
  if (!isGameOver()) scheduleComputerMove();
}

function scheduleComputerMove() {
  if (game.turn() === playerColor || isGameOver()) return;
  thinking = true;
  updateUI();
  aiTimer = window.setTimeout(() => {
    const move = chooseComputerMove();
    if (move && !isGameOver() && game.turn() !== playerColor) game.move(move);
    thinking = false;
    updateUI();
  }, 180);
}

function chooseComputerMove() {
  const moves = game.moves({ verbose: true });
  if (!moves.length) return null;
  const level = difficultyElement.value;
  if (level === "easy") {
    const scored = moves.map((move) => {
      let score = Math.random() * 150;
      if (move.captured) score += VALUES[move.captured] * 0.4;
      if (move.san.includes("+")) score += 45;
      return { move, score };
    }).sort((a, b) => b.score - a.score);
    return scored[Math.floor(Math.random() * Math.min(scored.length, 5))].move;
  }
  const depth = level === "hard" ? 3 : 2;
  let bestScore = -Infinity;
  let bestMoves = [];
  const computerColor = playerColor === "w" ? "b" : "w";
  for (const move of shuffle(moves)) {
    game.move(move);
    const score = minimax(depth - 1, -Infinity, Infinity, false, computerColor);
    game.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMoves = [move];
    } else if (score === bestScore) bestMoves.push(move);
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

function minimax(depth, alpha, beta, maximizing, aiColor) {
  if (depth === 0 || isGameOver()) return evaluatePosition(aiColor);
  const moves = shuffle(game.moves({ verbose: true }));
  if (maximizing) {
    let best = -Infinity;
    for (const move of moves) {
      game.move(move);
      best = Math.max(best, minimax(depth - 1, alpha, beta, false, aiColor));
      game.undo();
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  }
  let best = Infinity;
  for (const move of moves) {
    game.move(move);
    best = Math.min(best, minimax(depth - 1, alpha, beta, true, aiColor));
    game.undo();
    beta = Math.min(beta, best);
    if (beta <= alpha) break;
  }
  return best;
}

function evaluatePosition(color) {
  if (game.isCheckmate()) return game.turn() === color ? -100000 : 100000;
  if (game.isDraw()) return 0;
  let score = 0;
  const board = game.board();
  board.forEach((rank, row) => rank.forEach((piece, column) => {
    if (!piece) return;
    const advance = piece.color === "w" ? 6 - row : row - 1;
    const center = 3.5 - (Math.abs(3.5 - column) + Math.abs(3.5 - row)) / 2;
    let positional = piece.type === "p" ? advance * 8 + center * 2 : piece.type === "n" || piece.type === "b" ? center * 7 : 0;
    if (piece.type === "k" && game.isCheck()) positional -= 22;
    score += (VALUES[piece.type] + positional) * (piece.color === color ? 1 : -1);
  }));
  return score;
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function getGameMessage() {
  if (game.isCheckmate()) return game.turn() === playerColor ? "Checkmate — the computer wins" : "Checkmate — you win!";
  if (game.isStalemate()) return "Stalemate — it’s a draw";
  if (game.isThreefoldRepetition()) return "Draw by threefold repetition";
  if (game.isInsufficientMaterial()) return "Draw — insufficient material";
  if (game.isDraw()) return "Draw — the 50-move rule";
  if (thinking) return "Thinking through a move…";
  if (game.isCheck()) return game.turn() === playerColor ? "You’re in check!" : "Computer is in check";
  return game.turn() === playerColor ? "Your turn — make a move" : "Computer’s turn";
}

function updateUI() {
  renderBoard();
  renderHistory();
  renderCaptured();
  const ended = isGameOver();
  const message = getGameMessage();
  $("#user-detail").textContent = message;
  $("#computer-detail").textContent = ended ? "Game finished" : thinking ? "Considering its options…" : game.turn() === playerColor ? "Waiting for your move" : "Making a move…";
  $("#turn-indicator").innerHTML = `<span class="${thinking || game.turn() !== playerColor ? "computer-turn" : ""}"></span> ${ended ? "GAME OVER" : thinking || game.turn() !== playerColor ? "COMPUTER THINKING" : "YOUR TURN"}`;
  $(".you-label").textContent = playerColor === "w" ? "WHITE" : "BLACK";
  $(".user-avatar").textContent = PIECES[playerColor].p;
  $(".computer-avatar").textContent = PIECES[playerColor === "w" ? "b" : "w"].p;
  const history = game.history();
  $("#undo-button").disabled = history.length === 0 || thinking;
  $("#redo-button").disabled = redoLine.length === 0 || thinking;
  $("#move-count").textContent = `${history.length} ${history.length === 1 ? "move" : "moves"}`;
  if (ended) $("#user-detail").textContent = message;
}

function renderHistory() {
  const history = game.history();
  if (!history.length) {
    historyElement.innerHTML = '<div class="empty-history"><span>♘</span><p>Your first move is waiting.</p></div>';
    return;
  }
  const rows = [];
  for (let index = 0; index < history.length; index += 2) {
    const number = Math.floor(index / 2) + 1;
    const whiteMove = history[index] || "";
    const blackMove = history[index + 1] || "";
    rows.push(`<div class="history-row"><span class="history-number">${number}.</span><span class="${index === history.length - 1 ? "latest-move" : ""}">${whiteMove}</span><span class="${index + 1 === history.length - 1 ? "latest-move" : ""}">${blackMove}</span></div>`);
  }
  historyElement.innerHTML = rows.join("");
  historyElement.scrollTop = historyElement.scrollHeight;
}

function renderCaptured() {
  const captures = { w: [], b: [] };
  game.history({ verbose: true }).forEach((move) => {
    if (move.captured) captures[move.color === "w" ? "w" : "b"].push(move.captured);
  });
  $("#user-captured").textContent = captures[playerColor].map((piece) => PIECES[playerColor === "w" ? "b" : "w"][piece]).join(" ");
  $("#computer-captured").textContent = captures[playerColor === "w" ? "b" : "w"].map((piece) => PIECES[playerColor][piece]).join(" ");
}

function restartGame() {
  window.clearTimeout(aiTimer);
  game = new Chess();
  selectedSquare = null;
  legalTargets = [];
  redoLine = [];
  thinking = false;
  flipped = playerColor === "b";
  updateUI();
  if (playerColor === "b") scheduleComputerMove();
}

function undoTurn() {
  if (thinking || !game.history().length) return;
  const removed = [];
  do {
    const move = game.undo();
    if (!move) break;
    removed.unshift({ from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) });
  } while (game.history().length && game.turn() !== playerColor);
  redoLine = [...removed, ...redoLine];
  selectedSquare = null;
  legalTargets = [];
  updateUI();
}

function redoTurn() {
  if (!redoLine.length || thinking) return;
  while (redoLine.length) {
    const move = redoLine.shift();
    game.move(move);
    if (game.turn() === playerColor || isGameOver()) break;
  }
  updateUI();
  if (!isGameOver() && game.turn() !== playerColor) scheduleComputerMove();
}

function showPromotionDialog(color) {
  const dialog = $("#promotion-dialog");
  const buttons = [...dialog.querySelectorAll("button")];
  buttons.forEach((button) => { button.textContent = PIECES[color][button.value]; });
  return new Promise((resolve) => {
    promotionResolve = resolve;
    dialog.showModal();
  });
}

$("#promotion-dialog").addEventListener("close", () => {
  const choice = $("#promotion-dialog").returnValue || "q";
  if (promotionResolve) promotionResolve(choice);
  promotionResolve = null;
});
$("#difficulty").addEventListener("change", () => showToast(`${difficultyElement.options[difficultyElement.selectedIndex].text.split(" · ")[0]} difficulty selected`));
document.querySelectorAll(".color-choice").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".color-choice").forEach((choice) => {
    const active = choice === button;
    choice.classList.toggle("active", active);
    choice.setAttribute("aria-pressed", String(active));
  });
  playerColor = button.dataset.color;
  restartGame();
  showToast(`You’re playing as ${playerColor === "w" ? "White" : "Black"}`);
}));
$("#undo-button").addEventListener("click", undoTurn);
$("#redo-button").addEventListener("click", redoTurn);
$("#flip-button").addEventListener("click", () => { flipped = !flipped; renderBoard(); });
$("#restart-button").addEventListener("click", restartGame);
$("#new-game-button").addEventListener("click", () => {
  restartGame();
  showToast("A fresh game. Good luck!");
});
$(".theme-toggle").addEventListener("click", () => {
  const dark = document.documentElement.dataset.theme !== "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  localStorage.setItem("chess-theme", dark ? "dark" : "light");
});

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2100);
}

const savedTheme = localStorage.getItem("chess-theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
restartGame();
