const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 8080);
const HOST = "0.0.0.0";
const ROOT = __dirname;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("[SUPABASE] Thiếu SUPABASE_URL hoặc SUPABASE_SECRET_KEY trong Environment Variables.");
    process.exit(1);
}

const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

let people = [];

async function loadPeople() {
    const { data, error } = await supabase
        .from("people")
        .select("id, username, password, score, created_at")
        .order("id", { ascending: true });

    if (error) {
        console.error("[SUPABASE] Không thể tải bảng people:", error.message);
        process.exit(1);
    }

    people = (data || []).map(row => ({
        id: row.id,
        username: row.username,
        password: row.password,
        score: Number(row.score) || 0,
        createdAt: row.created_at
    }));

    console.log(`[SUPABASE] Loaded ${people.length} account(s) from people`);
}

function normalizeUser(v) {
    return String(v ?? "").trim();
}

function findAccount(username) {
    return people.find(p =>
        String(p.username ?? "").toLowerCase() === String(username).toLowerCase()
    );
}

async function createAccount(username, password) {
    const createdAt = new Date().toISOString();

    const { data, error } = await supabase
        .from("people")
        .insert({
            username,
            password,
            score: 0,
            created_at: createdAt
        })
        .select("id, username, password, score, created_at")
        .single();

    if (error) {
        if (error.code === "23505") {
            return { exists: true, account: null };
        }
        throw error;
    }

    const account = {
        id: data.id,
        username: data.username,
        password: data.password,
        score: Number(data.score) || 0,
        createdAt: data.created_at
    };

    people.push(account);
    return { exists: false, account };
}

async function updateAccountScore(username, score) {
    const cleanScore = Number(score) || 0;

    const { error } = await supabase
        .from("people")
        .update({ score: cleanScore })
        .eq("username", username);

    if (error) throw error;

    const account = findAccount(username);
    if (account) account.score = cleanScore;
}

const server = http.createServer((req, res) => {
    let url = decodeURIComponent(req.url.split("?")[0]);

    if (url === "/") url = "/s.html";

    if (url === "/s.html") {
        const file = path.join(ROOT, "s.html");

        fs.readFile(file, (err, data) => {
            if (err) {
                res.writeHead(500, {
                    "Content-Type": "text/plain; charset=utf-8"
                });
                res.end("Không tìm thấy s.html");
                return;
            }

            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-cache"
            });

            res.end(data);
        });

        return;
    }

    res.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
    });

    res.end("404 - Not Found");
});

const io = new Server(server, {
    cors: {
        origin: "*"
    },
    maxHttpBufferSize: 5e6
});

const players = new Map();
const sessions = new Map();

let round = 0;
let drawerId = null;
let currentWord = null;
let currentCategory = null;
let roundRunning = false;
let chooseRunning = false;
let roundTimer = null;
let chooseTimer = null;
let roundEndsAt = 0;
let chooseEndsAt = 0;

const ROUND_TIME = 60;
const CHOOSE_TIME = 15;
const MIN_PLAYERS = 2;

const WORDS = [
    {
        word: "con mèo",
        category: "Động vật"
    },
    {
        word: "con chó",
        category: "Động vật"
    },
    {
        word: "con cá",
        category: "Động vật"
    },
    {
        word: "con voi",
        category: "Động vật"
    },
    {
        word: "con hổ",
        category: "Động vật"
    },
    {
        word: "con thỏ",
        category: "Động vật"
    },
    {
        word: "con gà",
        category: "Động vật"
    },
    {
        word: "con chim",
        category: "Động vật"
    },

    {
        word: "ngôi nhà",
        category: "Đồ vật"
    },
    {
        word: "chiếc ô",
        category: "Đồ vật"
    },
    {
        word: "điện thoại",
        category: "Đồ vật"
    },
    {
        word: "máy tính",
        category: "Đồ vật"
    },
    {
        word: "cây bút",
        category: "Đồ vật"
    },
    {
        word: "chiếc ghế",
        category: "Đồ vật"
    },
    {
        word: "đồng hồ",
        category: "Đồ vật"
    },

    {
        word: "mặt trời",
        category: "Thiên nhiên"
    },
    {
        word: "mặt trăng",
        category: "Thiên nhiên"
    },
    {
        word: "ngọn núi",
        category: "Thiên nhiên"
    },
    {
        word: "cây xanh",
        category: "Thiên nhiên"
    },
    {
        word: "đám mây",
        category: "Thiên nhiên"
    },

    {
        word: "đá bóng",
        category: "Hoạt động"
    },
    {
        word: "bơi",
        category: "Hoạt động"
    },
    {
        word: "đọc sách",
        category: "Hoạt động"
    },
    {
        word: "ngủ",
        category: "Hoạt động"
    },
    {
        word: "chạy",
        category: "Hoạt động"
    }
];

function cleanName(name) {
    name = String(name || "").trim();

    if (!name) {
        name = "Người chơi";
    }

    name = name.replace(/[<>]/g, "");

    if (name.length > 20) {
        name = name.slice(0, 20);
    }

    return name;
}

function playerList() {
    return [...players.values()].map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        guessed: p.guessed,
        drawer: p.id === drawerId
    }));
}

function broadcastPlayers() {
    io.emit("playerList", playerList());
}

function toast(message, type = "normal") {
    io.emit("toast", {
        message,
        type
    });
}

function chooseRandomWords(count = 3) {
    const shuffled = [...WORDS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
}

function resetRoundPlayerState() {
    for (const p of players.values()) {
        p.guessed = false;
        p.roundPoints = 0;
    }
}

function getNextDrawer() {
    const list = [...players.values()];

    if (!list.length) return null;

    if (!drawerId) {
        return list[0].id;
    }

    const index = list.findIndex(p => p.id === drawerId);

    if (index === -1) {
        return list[0].id;
    }

    return list[(index + 1) % list.length].id;
}

function stopTimers() {
    if (roundTimer) {
        clearInterval(roundTimer);
        roundTimer = null;
    }

    if (chooseTimer) {
        clearInterval(chooseTimer);
        chooseTimer = null;
    }
}

function startGameIfPossible() {
    if (roundRunning || chooseRunning) return;

    if (players.size < MIN_PLAYERS) {
        io.emit("waitingForPlayers", {
            count: players.size,
            minimum: MIN_PLAYERS
        });
        return;
    }

    startChoosePhase();
}

function startChoosePhase() {
    stopTimers();

    if (players.size < MIN_PLAYERS) {
        startGameIfPossible();
        return;
    }

    round++;

    drawerId = getNextDrawer();

    if (!drawerId) return;

    resetRoundPlayerState();

    roundRunning = false;
    chooseRunning = true;

    const options = chooseRandomWords(3);

    chooseEndsAt = Date.now() + CHOOSE_TIME * 1000;

    io.emit("roundStart", {
        round,
        drawerId,
        drawerName: players.get(drawerId)?.name || ""
    });

    io.to(drawerId).emit("chooseWord", {
        options,
        seconds: CHOOSE_TIME
    });

    for (const p of players.values()) {
        if (p.id !== drawerId) {
            io.to(p.id).emit("chooseTimer", {
                seconds: CHOOSE_TIME
            });
        }
    }

    let last = CHOOSE_TIME;

    chooseTimer = setInterval(() => {
        const left = Math.max(
            0,
            Math.ceil((chooseEndsAt - Date.now()) / 1000)
        );

        if (left !== last) {
            last = left;
            io.emit("chooseTimer", {
                seconds: left
            });
        }

        if (left <= 0) {
            clearInterval(chooseTimer);
            chooseTimer = null;

            if (chooseRunning) {
                const fallback = options[0];

                chooseWord(drawerId, fallback.word, fallback.category);
            }
        }
    }, 250);
}

function chooseWord(socketId, word, category) {
    if (!chooseRunning) return;
    if (socketId !== drawerId) return;

    const drawer = players.get(socketId);

    if (!drawer) return;

    const valid = WORDS.find(
        w =>
            w.word === word &&
            w.category === category
    );

    if (!valid) return;

    stopTimers();

    currentWord = valid.word;
    currentCategory = valid.category;

    chooseRunning = false;
    roundRunning = true;

    roundEndsAt = Date.now() + ROUND_TIME * 1000;

    io.emit("startDrawing", {
        drawerId,
        drawerName: drawer.name,
        category: currentCategory,
        seconds: ROUND_TIME
    });

    io.to(drawerId).emit("drawingStarted", {
        word: currentWord,
        category: currentCategory
    });

    const options = createGuessOptions(currentWord);

    for (const p of players.values()) {
        if (p.id !== drawerId) {
            io.to(p.id).emit("guessOptions", {
                options,
                category: currentCategory
            });
        }
    }

    io.emit("timerUpdate", {
        seconds: ROUND_TIME
    });

    let last = ROUND_TIME;

    roundTimer = setInterval(() => {
        const left = Math.max(
            0,
            Math.ceil((roundEndsAt - Date.now()) / 1000)
        );

        if (left !== last) {
            last = left;

            io.emit("timerUpdate", {
                seconds: left
            });
        }

        if (left <= 0) {
            clearInterval(roundTimer);
            roundTimer = null;

            if (roundRunning) {
                endRound();
            }
        }
    }, 250);
}

function createGuessOptions(correct) {
    const other = WORDS
        .filter(w => w.word !== correct)
        .sort(() => Math.random() - 0.5)
        .slice(0, 2)
        .map(w => w.word);

    return [correct, ...other].sort(
        () => Math.random() - 0.5
    );
}

function endRound() {
    if (!roundRunning) return;

    stopTimers();

    roundRunning = false;
    chooseRunning = false;

    io.emit("revealAnswer", {
        word: currentWord,
        category: currentCategory
    });

    setTimeout(() => {
        if (players.size >= MIN_PLAYERS) {
            io.emit("showScoreboard", {
                players: playerList(),
                word: currentWord
            });

            setTimeout(() => {
                currentWord = null;
                currentCategory = null;

                startChoosePhase();
            }, 4000);
        } else {
            currentWord = null;
            currentCategory = null;

            startGameIfPossible();
        }
    }, 100);
}

function allGuessersFinished() {
    let guessers = 0;
    let finished = 0;

    for (const p of players.values()) {
        if (p.id === drawerId) continue;

        guessers++;

        if (p.guessed) {
            finished++;
        }
    }

    return guessers > 0 && guessers === finished;
}

function sendCurrentState(socket) {
    socket.emit("playerList", playerList());

    if (players.size < MIN_PLAYERS) {
        socket.emit("waitingForPlayers", {
            count: players.size,
            minimum: MIN_PLAYERS
        });

        return;
    }

    if (roundRunning) {
        socket.emit("startDrawing", {
            drawerId,
            drawerName: players.get(drawerId)?.name || "",
            category: currentCategory,
            seconds: Math.max(
                0,
                Math.ceil(
                    (roundEndsAt - Date.now()) / 1000
                )
            )
        });

        if (socket.id !== drawerId) {
            socket.emit("guessOptions", {
                options: createGuessOptions(currentWord),
                category: currentCategory
            });
        }
    }
}

io.on("connection", socket => {
    function sendAuthError(message) { socket.emit("authError", { message }); }

    socket.on("register", async data => {
        const username = normalizeUser(data?.username);
        const password = String(data?.password ?? "");
        if (!username) return sendAuthError("Vui lòng nhập tên tài khoản.");
        if (!password) return sendAuthError("Vui lòng nhập mật khẩu.");
        if (findAccount(username)) return sendAuthError("Tài khoản đã tồn tại.");

        try {
            const result = await createAccount(username, password);

            if (result.exists) {
                return sendAuthError("Tài khoản đã tồn tại.");
            }

            sessions.set(socket.id, username);
            socket.emit("authOk", { username, score: 0 });
            console.log(`[AUTH] REGISTER: ${username} | socket=${socket.id}`);
        } catch (error) {
            console.error("[AUTH] REGISTER ERROR:", error.message);
            sendAuthError("Không thể tạo tài khoản. Vui lòng thử lại.");
        }
    });

    socket.on("login", async data => {
        const username = normalizeUser(data?.username);
        const password = String(data?.password ?? "");
        try {
            const account = findAccount(username);

            if (!account || String(account.password ?? "") !== password) {
                return sendAuthError("Sai tài khoản hoặc mật khẩu.");
            }

            sessions.set(socket.id, account.username);
            socket.emit("authOk", {
                username: account.username,
                score: Number(account.score) || 0
            });
            console.log(`[AUTH] LOGIN: ${account.username} | socket=${socket.id}`);
        } catch (error) {
            console.error("[AUTH] LOGIN ERROR:", error.message);
            sendAuthError("Không thể đăng nhập.");
        }
    });

    socket.on("requestSession", async () => {
        const username = sessions.get(socket.id);
        if (!username) return;

        const account = findAccount(username);
        if (account) {
            socket.emit("authOk", {
                username: account.username,
                score: Number(account.score) || 0
            });
        }
    });
    console.log("CONNECT:", socket.id);

    socket.emit("welcome", {
        id: socket.id
    });

    socket.on("changeName", async name => {
        const username = sessions.get(socket.id);
        if (!username) return socket.emit("authError", { message: "Bạn cần đăng nhập trước." });
        const clean = cleanName(username);
        const account = findAccount(username);
        let p = players.get(socket.id);
        if (!p) {
            p = { id: socket.id, name: clean, username, score: account?.score || 0, guessed: false, roundPoints: 0 };
            players.set(socket.id, p);
            console.log(`[GAME] JOIN: ${clean} | socket=${socket.id}`);
            io.emit("systemMessage", { message: `👋 ${clean} đã vào phòng` });
        } else { p.name = clean; }
        broadcastPlayers();
        socket.emit("toast", { message: `Đã tham gia với tên ${clean}`, type: "success" });
        sendCurrentState(socket);
        startGameIfPossible();
    });

    socket.on("chat", text => {
        const p = players.get(socket.id);
        if (!p) return;
        const message = String(text || "").trim().slice(0, 120);
        if (!message) return;
        const payload = { id: Date.now() + Math.random(), name: p.name, message, at: Date.now() };
        io.emit("chatMessage", payload);
        console.log(`[CHAT] ${p.name}: ${message}`);
    });

    socket.on("wordChosen", data => {
        if (!data) return;

        chooseWord(
            socket.id,
            String(data.word || ""),
            String(data.category || "")
        );
    });

    socket.on("drawLine", data => {
        if (!roundRunning) return;
        if (socket.id !== drawerId) return;

        if (!data) return;

        socket.broadcast.emit("drawLine", {
            x0: Number(data.x0),
            y0: Number(data.y0),
            x1: Number(data.x1),
            y1: Number(data.y1),
            color: String(data.color || "#111827"),
            size: Number(data.size || 5),
            erase: !!data.erase
        });
    });

    socket.on("clearCanvas", () => {
        if (!roundRunning) return;
        if (socket.id !== drawerId) return;

        socket.broadcast.emit("clearCanvas");
    });

    socket.on("removeAllImages", () => {
        if (!roundRunning) return;
        if (socket.id !== drawerId) return;

        socket.broadcast.emit("removeAllImages");
    });

    socket.on("removeImage", id => {
        if (!roundRunning) return;
        if (socket.id !== drawerId) return;

        socket.broadcast.emit("removeImage", id);
    });

    socket.on("importImage", data => {
        if (!roundRunning) return;
        if (socket.id !== drawerId) return;

        if (!data) return;

        const image = {
            id: String(data.id || Date.now()),
            src: String(data.src || ""),
            x: Number(data.x || 0),
            y: Number(data.y || 0),
            width: Number(data.width || 200),
            height: Number(data.height || 200)
        };

        if (!image.src.startsWith("data:image/")) {
            return;
        }

        if (image.src.length > 4 * 1024 * 1024) {
            return;
        }

        socket.broadcast.emit("importImage", image);
    });

    socket.on("guess", async answer => {
        if (!roundRunning) return;

        if (socket.id === drawerId) return;

        const p = players.get(socket.id);

        if (!p) return;

        if (p.guessed) return;

        answer = String(answer || "").trim();

        if (!answer) return;

        if (
            answer.toLocaleLowerCase() ===
            String(currentWord).toLocaleLowerCase()
        ) {
            p.guessed = true;

            const elapsed =
                ROUND_TIME -
                Math.max(
                    0,
                    Math.ceil(
                        (roundEndsAt - Date.now()) / 1000
                    )
                );

            const points = Math.max(
                10,
                100 - elapsed
            );

            p.score += points;
            p.roundPoints = points;

            try {
                await updateAccountScore(p.username, p.score);
            } catch (error) {
                console.error("[SCORE] Không thể lưu điểm:", error.message);
            }

            io.emit("correctGuess", {
                playerId: p.id,
                playerName: p.name,
                points
            });

            socket.emit("toast", {
                message: `Đúng! +${points} điểm`,
                type: "success"
            });

            socket.emit("revealAnswer", {
                word: currentWord,
                category: currentCategory
            });

            broadcastPlayers();

            if (allGuessersFinished()) {
                endRound();
            }
        } else {
            socket.emit("wrongGuess", {
                answer
            });

            socket.emit("toast", {
                message: "Sai rồi! Thử lại sau 3 giây.",
                type: "error"
            });

            p.guessLockedUntil = Date.now() + 3000;
        }
    });

    socket.on("disconnect", () => {
        const wasDrawer = socket.id === drawerId;

        players.delete(socket.id);

        const username = sessions.get(socket.id);
        console.log(`[GAME] LEAVE: ${username || "chưa đăng nhập"} | socket=${socket.id}`);
        sessions.delete(socket.id);

        broadcastPlayers();

        if (wasDrawer) {
            stopTimers();

            drawerId = null;
            currentWord = null;
            currentCategory = null;
            roundRunning = false;
            chooseRunning = false;

            io.emit("clearCanvas");
            io.emit("removeAllImages");

            if (players.size >= MIN_PLAYERS) {
                toast(
                    "Người đang vẽ đã thoát. Đang bắt đầu lượt mới..."
                );

                setTimeout(() => {
                    startChoosePhase();
                }, 1000);
            } else {
                io.emit("waitingForPlayers", {
                    count: players.size,
                    minimum: MIN_PLAYERS
                });
            }

            return;
        }

        if (players.size < MIN_PLAYERS) {
            stopTimers();

            roundRunning = false;
            chooseRunning = false;

            io.emit("waitingForPlayers", {
                count: players.size,
                minimum: MIN_PLAYERS
            });
        }
    });
});

async function startServer() {
    await loadPeople();

    server.listen(PORT, HOST, () => {
        console.log("");
        console.log("=================================");
        console.log(" VE HINH DOAN CHU - SERVER");
        console.log("=================================");
        console.log(`Local: http://localhost:${PORT}/s.html`);
        console.log(`Port : ${PORT}`);
        console.log("Database: Supabase / people");
        console.log("[READY] Đăng nhập bằng tài khoản để vào game.");
        console.log("=================================");
        console.log("");
    });
}

startServer().catch(error => {
    console.error("[SERVER] Không thể khởi động:", error);
    process.exit(1);
});