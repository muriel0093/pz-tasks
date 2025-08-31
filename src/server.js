const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const z = require("zod");

const port = 2469;
const app = express();
let sql;

const secret = "uj1SQDFwAI9EWt1CxWpmJHd1XgJbytIB";
const expiresIn = "30d";

const limitPage = 10;

app.use(express.static(__dirname));
app.use(express.json());
app.use(cors());
app.use(cookieParser());

const db = new sqlite3.Database("src/database/rats.db", sqlite3.OPEN_READWRITE, (err) => {
  if (err) return console.log(err.message);
});

app.get("/CreateDB", (req, res) => {
  sqlCreate = `
        CREATE TABLE tarefas(id INTEGER PRIMARY KEY, codigo INTEGER, titulo VARCHAR, descricao VARCHAR);
        CREATE TABLE usuarios(id INTEGER PRIMARY KEY, nome VARCHAR, senha VARCHAR);
    `;
  db.run(sqlCreate);
});

app.delete("/ClearTasks", (req, res) => {
  const sql = "DELETE FROM tarefas";
  db.run(sql, [], function (err) {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "Erro ao limpar o banco" });
    }

    // this.changes retorna quantas linhas foram afetadas
    return res.status(200).json({
      message: `Banco limpo com sucesso. ${this.changes} tarefas removidas.`,
    });
  });
});

app.post("/PostTasks", (req, res) => {
  const { codigo, titulo, descricao, prioridade } = req.body;

  const TaskModel = z.object({
    codigo: z.int("Precisa ser um número inteiro").gte(0, "Precisa ser maior que 0").lte(99999999, "Máximo de 8 caracteres"),
    titulo: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(128, "Máximo de 128 caracteres"),
    descricao: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(512, "Máximo de 512 caracteres"),
    prioridade: z.literal(["NORMAL", "MODERADO", "PRIORITARIO", "URGENTE"], "Não é um valor válido"),
  });

  const result = TaskModel.safeParse({ codigo, titulo, descricao, prioridade });

  if (result.error) {
    return res.status(400).json({ code: "INVALID_FIELD", errors: result.error.issues.map(e => ({ field: e.path[0], error: e.message })) });
  }

  sql = "INSERT INTO tarefas(codigo, titulo, descricao, prioridade, finalizado) VALUES (?, ?, ?, ?, 0);";
  db.run(sql, [codigo, titulo, descricao, prioridade], (err) => {
    if (err) {
      return res.status(500).json({ error: "ERRO AO INSERIR NO BANCO" });
    }

    return res.status(200).json({ message: "INSERIDO COM SUCESSO" });
  });
});

app.get("/GetTasks/:page", (req, res) => {
  const ordem = req.query.ordem || undefined;
  const filtro = req.query.filtro || undefined;
  let textOrdem;

  switch (ordem.toUpperCase()) {
    case "PRIORIDADE":
      textOrdem = ` 
        ORDER BY CASE t.prioridade 
          WHEN "URGENTE" THEN 1
          WHEN "PRIORITARIO" THEN 2
          WHEN "MODERADO" THEN 3
          WHEN "NORMAL" THEN 4
        END
      `;
      break;
    case "ULTIMOS":
      textOrdem = "ORDER BY t.id DESC";
      break;
    case "PRIMEIROS":
      textOrdem = "ORDER BY t.id ASC";
      break;
    default:
      textOrdem = ` 
        ORDER BY CASE t.prioridade 
          WHEN "URGENTE" THEN 1
          WHEN "PRIORITARIO" THEN 2
          WHEN "MODERADO" THEN 3
          WHEN "NORMAL" THEN 4
        END
      `;
      break;
  }

  let page;
  try {
    page = Number(req.params.page);
    if (page <= 0) throw new Error();
  } catch {
    res.status(400).json({ error: "Página inválida" });
  }

  sql = `
    SELECT 
    t.codigo, 
    t.titulo, 
    t.descricao, 
    t.prioridade, 
    t.finalizado,
    t.id_usuario,
    u.nome,
    u.foto,
    (SELECT COUNT(*) FROM tarefas WHERE finalizado = 0${filtro ? ` AND (codigo LIKE ? OR titulo LIKE ?)` : ""}) as total
    FROM tarefas t 
    LEFT JOIN usuarios u ON u.id = t.id_usuario
    WHERE t.finalizado = 0
    ${filtro ? `AND (t.codigo LIKE ? OR t.titulo LIKE ?)` : ""}
    ${textOrdem}
    LIMIT ${limitPage} OFFSET ${(page - 1) * limitPage};
  `;
  db.all(sql, filtro ? [`%${filtro}%`, `%${filtro}%`, `%${filtro}%`, `%${filtro}%`] : [], (err, rows) => {
    if (err) return "NO DATA";
    if (rows.length <= 0) return res.status(200).json({ rows });

    res.status(200).json({
      pages: Math.ceil(rows[0].total / limitPage),
      total: rows[0].total,
      limit: limitPage,
      rows: rows.map(e => ({
        codigo: e.codigo,
        titulo: e.titulo,
        descricao: e.descricao,
        prioridade: e.prioridade,
        finalizado: e.finalizado === 1 ? true : false,
        usuario: {
          id: e.id_usuario, nome: e.nome, foto: e.foto
        },
      })),
    });
  });
});

app.post("/auth/register", (req, res) => {
  const { nome, senha } = req.body;

  const UserModel = z.object({
    nome: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(24, "Máximo de 24 caracteres"),
    senha: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(32, "Máximo de 32 caracteres"),
  });

  const result = UserModel.safeParse({ nome, senha });

  if (result.error) {
    return res.status(400).json(result.error.issues.map(e => ({ field: e.path[0], error: e.message })));
  }

  bcrypt.genSalt(10, (err, salt) => {
    if (err) {
      return res
        .status(500)
        .json({ error: "Erro ao cadastrar usuário | (SALT)" });
    }
    bcrypt.hash(senha, salt, (err, hash) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Erro ao cadastrar usuário | (HASH)" });
      }

      sql = "INSERT INTO usuarios(nome, senha, cargo) VALUES (?, ?, 'USER');";
      db.run(sql, [nome, hash], (err) => {
        if (err) {
          if (err.message === "SQLITE_CONSTRAINT: UNIQUE constraint failed: usuarios.nome") {
            return res.status(409).json({ error: "Já existe um usuário com este nome" });
          }
          return res
            .status(500)
            .json({ error: "Erro ao cadastrar usuário | (INSERT)" });
        } else {
          return res
            .status(201)
            .json({ message: "Usuário cadastrado com sucesso" });
        }
      });
    });
  });
});

app.post("/auth/login", (req, res) => {
  const { nome, senha } = req.body;

  const UserModel = z.object({
    nome: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(24, "Máximo de 24 caracteres"),
    senha: z.string("Precisa ser um texto").min(1, "Não pode ser vazio").max(32, "Máximo de 32 caracteres"),
  });

  const result = UserModel.safeParse({ nome, senha });

  if (result.error) {
    return res.status(400).json(result.error.issues.map(e => ({ field: e.path[0], error: e.message })));
  }

  sql = "SELECT id, senha FROM usuarios WHERE nome = ?;";
  db.all(sql, [nome], (err, data) => {
    if (err) return res.status(500).json("Erro ao logar usuário | (SQL)");
    if (data.length <= 0)
      return res
        .status(404)
        .json({ error: "Usuário ou senha estão incorretos" });

    bcrypt.compare(senha, data[0].senha, (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Erro ao logar usuário | (COMPARE)" });
      }

      if (result) {
        const token = jwt.sign({ id: data[0].id }, secret, {
          expiresIn,
        });
        res.cookie("token", token, {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
          maxAge: 30 * 24 * 60 * 1000,
        });
        return res.status(200).json({
          message: "Usuário logado com sucesso",
        });
      } else {
        return res
          .status(404)
          .json({ error: "Usuário ou senha estão incorretos" });
      }
    });
  });
});

function authToken(req, res, next) {
  const token = req.cookies.token || undefined;

  if (!token) return res.redirect("/login");
  try {
    jwt.verify(token, secret);
    next();
  } catch (error) {
    return res.redirect("/login");
  }
}

function authTokenAdmin(req, res, next) {
  const token = req.cookies.token || undefined;

  sql = "SELECT cargo FROM usuarios WHERE id = ?;";

  if (!token) return res.redirect("/login");
  try {
    const decoded = jwt.verify(token, secret);
    db.all(sql, [decoded.id], (err, data) => {
      if (err) return res.redirect("/");
      if (data[0].cargo !== "ADMIN") return res.redirect("/");
      next();
    });
  } catch (error) {
    return res.redirect("/login");
  }
}

function getUserId(token) {
  try {
    const decoded = jwt.verify(token, secret);
    return decoded.id;
  } catch {
    return undefined;
  }
};

// app.get("/perfil/info", (req, res) => {
//   const token = req.cookies.token || undefined;

//   if (!token) return res.status(401).json({ error: "Usuário sem TOKEN" });

//   sql = "SELECT nome, foto, cargo FROM usuarios WHERE id = ?;";
//   db.all(sql, [getUserId(token)], (err, data) => {
//     if (err) {
//       return res.status(500).json({ error: "Erro ao buscar o usuário" });
//     }

//     if (data.length <= 0) {
//       return res.status(404).json({ error: "Usuário não encontrado" });
//     }

//     return res.status(200).json({ nome: data[0].nome, foto: data[0].foto, cargo: data[0].cargo });
//   });
// });

// PAGES

let page;
const layout = fs.readFileSync("src/layout.html", "utf-8");

app.get('/auth/logout', authToken, (req, res) => {
  res.clearCookie('token', { path: '/' });
  return res.redirect("/login");

});

app.get("/", authToken, (req, res) => {
  page = layout.replace("{{NAVBAR}}", fs.readFileSync("src/components/navbar.html"));
  page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/index.html"));
  res.send(page);
});

app.get("/admin", authTokenAdmin, (req, res) => {
  page = layout.replace("{{NAVBAR}}", fs.readFileSync("src/components/navbar.html"));
  page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/admin.html"));
  res.send(page);
});

app.get("/register", (req, res) => {
  page = layout.replace("{{NAVBAR}}", "");
  page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/register.html"));
  res.send(page);
});

app.get("/login", (req, res) => {
  page = layout.replace("{{NAVBAR}}", "");
  page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/login.html"));
  res.send(page);
});

app.get("/perfil", authToken, (req, res) => {
  const token = req.cookies.token || undefined;

  sql = "SELECT nome FROM usuarios WHERE id = ?;";
  db.all(sql, [getUserId(token)], (err, data) => {
    if (err) return res.redirect("/");
    if (data.length <= 0) return res.redirect("/");

    res.redirect(`/perfil/u/${data[0].nome}`);
  });
});

app.get("/perfil/u/:nome", authToken, (req, res) => {
  const nome = req.params.nome || undefined;
  if (!nome) return res.redirect("/");

  let user;

  sql = "SELECT nome, foto FROM usuarios WHERE nome = ?;";
  db.all(sql, [nome], (err, data) => {
    if (err) return res.redirect("/");
    if (data.length <= 0) return res.redirect("/");

    user = { nome: data[0].nome, foto: data[0].foto };
    page = layout.replace("{{NAVBAR}}", fs.readFileSync("src/components/navbar.html"));
    page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/perfil.html"));
    page = page.replace("'USER_STRING'", `'${JSON.stringify(user)}'`);
    res.send(page);
  });
});

app.use(authToken, (req, res) => {
  page = layout.replace("{{NAVBAR}}", fs.readFileSync("src/components/navbar.html"));
  page = page.replace("{{CONTENT}}", fs.readFileSync("src/components/notfound.html"));
  res.send(page);
});

app.listen(port, () => {
  console.log("Server Start | PORT: " + port);
});