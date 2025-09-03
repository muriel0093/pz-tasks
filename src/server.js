const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const z = require("zod");
const { networkInterfaces } = require("os");
const { ca } = require("zod/v4/locales/index.d.cts");

const port = 2469;
const app = express();
let sql;

const secret = "uj1SQDFwAI9EWt1CxWpmJHd1XgJbytIB";
const expiresIn = "14d";

const limitPage = 10;

app.use(express.static(__dirname));
app.use(express.json());
app.use(cors());
app.use(cookieParser());

const db = new sqlite3.Database(
  "src/database/rats.db",
  sqlite3.OPEN_READWRITE,
  (err) => {
    if (err) return console.log(err.message);
  }
);

// METHODS

function updateToken(decoded, res) {
  const date = new Date();
  if (decoded.exp - date.getTime() / 1000 < (decoded.exp - decoded.iat) / 2) {
    const token = jwt.sign({ id: decoded.id }, secret, {
      expiresIn,
    });
    const decodedTime = jwt.verify(token, secret);
    res.cookie("token", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: (decodedTime.exp - decodedTime.iat) * 1000,
    });
  }
}

function nonAuth(req, res, next) {
  const token = req.cookies.token || undefined;

  try {
    const decoded = jwt.verify(token, secret);
    updateToken(decoded, res);
    return res.redirect("/");
  } catch (error) {
    next();
  }
}

function authAPI(req, res, next) {
  const token = req.cookies.token || undefined;

  if (!token) return res.status(401).json({ error: "Invalid Token" });

  try {
    const decoded = jwt.verify(token, secret);
    updateToken(decoded, res);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid Token" });
  }
}

function authAPIAdmin(req, res, next) {
  const token = req.cookies.token || undefined;

  if (!token) return res.status(401).json({ error: "Invalid Token" });

  sql = "SELECT cargo FROM usuarios WHERE id = ?;";

  try {
    const decoded = jwt.verify(token, secret);
    updateToken(decoded, res);
    db.all(sql, [decoded.id], (err, data) => {
      if (err) return res.status(401).json({ error: "Invalid Permission" });
      if (data[0].cargo !== "ADMIN")
        return res.status(401).json({ error: "Invalid Permission" });
      next();
    });
  } catch (error) {
    return res.status(401).json({ error: "Invalid Token" });
  }
}

function authToken(req, res, next) {
  const token = req.cookies.token || undefined;

  if (!token) return res.redirect("/login");
  try {
    const decoded = jwt.verify(token, secret);
    updateToken(decoded, res);
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
    updateToken(decoded, res);
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
}

// API

app.get("/CreateDB", authAPIAdmin, (req, res) => {
  sqlCreate = `
        CREATE TABLE tarefas(id INTEGER PRIMARY KEY, codigo INTEGER, titulo VARCHAR, descricao VARCHAR);
        CREATE TABLE usuarios(id INTEGER PRIMARY KEY, nome VARCHAR, senha VARCHAR);
    `;
  db.run(sqlCreate);
});

app.delete("/ClearTasks", authAPIAdmin, (req, res) => {
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

app.post("/PostTasks", authAPI, (req, res) => {
  const { codigo, titulo, descricao, prioridade, tipo } = req.body;

  const TaskSchema = z.object({
    codigo: z
      .int("Precisa ser um número inteiro")
      .gte(0, "Precisa ser maior que 0")
      .lte(99999999, "Máximo de 8 caracteres"),
    titulo: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(128, "Máximo de 128 caracteres"),
    descricao: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(512, "Máximo de 512 caracteres"),
    prioridade: z.literal(
      ["NORMAL", "MODERADO", "PRIORITARIO", "URGENTE"],
      "Não é um valor válido"
    ),
    tipo: z.literal(
      ["ADAPTATIVO", "CORRETIVO", "PREVENTIVO"],
      "Não é um valor válido"
    ),
  });

  const result = TaskSchema.safeParse({
    codigo,
    titulo,
    descricao,
    prioridade,
    tipo,
  });

  if (result.error) {
    return res.status(400).json({
      code: "INVALID_FIELD",
      errors: result.error.issues.map((e) => ({
        field: e.path[0],
        error: e.message,
      })),
    });
  }

  sql =
    "INSERT INTO tarefas(codigo, titulo, descricao, prioridade, tipo, finalizado) VALUES (?, ?, ?, ?, ?, 0);";
  db.run(sql, [codigo, titulo, descricao, prioridade, tipo], (err) => {
    if (err) {
      return res.status(500).json({ error: "ERRO AO INSERIR NO BANCO" });
    }

    return res.status(200).json({ message: "INSERIDO COM SUCESSO" });
  });
});

app.get("/GetTasks/:page", authAPI, (req, res) => {
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
    t.id,
    t.codigo, 
    t.titulo, 
    t.descricao, 
    t.prioridade, 
    t.tipo,
    t.finalizado,
    t.id_usuario,
    u.nome,
    u.foto,
    (SELECT COUNT(*) FROM tarefas WHERE finalizado = 0${
      filtro ? ` AND (codigo LIKE ? OR titulo LIKE ?)` : ""
    }) as total
    FROM tarefas t 
    LEFT JOIN usuarios u ON u.id = t.id_usuario
    WHERE t.finalizado = 0
    ${filtro ? `AND (t.codigo LIKE ? OR t.titulo LIKE ?)` : ""}
    ${textOrdem}
    LIMIT ${limitPage} OFFSET ${(page - 1) * limitPage};
  `;
  db.all(
    sql,
    filtro ? [`%${filtro}%`, `%${filtro}%`, `%${filtro}%`, `%${filtro}%`] : [],
    (err, rows) => {
      if (err) return "NO DATA";
      if (rows.length <= 0) return res.status(200).json({ rows });

      res.status(200).json({
        pages: Math.ceil(rows[0].total / limitPage),
        total: rows[0].total,
        limit: limitPage,
        rows: rows.map((e) => ({
          id: e.id,
          codigo: e.codigo,
          titulo: e.titulo,
          descricao: e.descricao,
          prioridade: e.prioridade,
          tipo: e.tipo,
          finalizado: e.finalizado === 1 ? true : false,
          usuario: {
            id: e.id_usuario,
            nome: e.nome,
            foto: e.foto,
          },
        })),
      });
    }
  );
});

app.get("/task/id/:id", authAPI, (req, res) => {
  let id;
  try {
    id = Number(req.params.id);
  } catch {
    res.status(400).json({ error: "ID precisa ser um número" });
  }

  sql = `
    SELECT 
    t.id,
    t.codigo, 
    t.titulo, 
    t.descricao, 
    t.prioridade,
    t.tipo, 
    t.finalizado,
    t.id_usuario,
    u.nome,
    u.foto
    FROM tarefas t 
    LEFT JOIN usuarios u ON u.id = t.id_usuario
    WHERE t.id = ?;
  `;
  db.all(sql, [id], (err, rows) => {
    if (err)
      return res
        .status(404)
        .json({ error: "Nenhuma task foi encontrada com esse ID!" });
    if (rows.length <= 0)
      return res
        .status(404)
        .json({ error: "Nenhuma task foi encontrada com esse ID" });

    const task = rows[0];

    res.status(200).json({
      id: task.id,
      codigo: task.codigo,
      titulo: task.titulo,
      descricao: task.descricao,
      prioridade: task.prioridade,
      tipo: task.tipo,
      finalizado: task.finalizado === 1 ? true : false,
      usuario: {
        id: task.id_usuario,
        nome: task.nome,
        foto: task.foto,
      },
    });
  });
});

app.get("/perfil/info", authAPI, (req, res) => {
  const token = req.cookies.token || undefined;

  if (!token) return res.status(401).json({ error: "Usuário sem TOKEN" });

  sql = "SELECT nome, foto, cargo FROM usuarios WHERE id = ?;";
  db.all(sql, [getUserId(token)], (err, data) => {
    if (err) {
      return res.status(500).json({ error: "Erro ao buscar o usuário" });
    }

    if (data.length <= 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res
      .status(200)
      .json({ nome: data[0].nome, foto: data[0].foto, cargo: data[0].cargo });
  });
});

app.patch("/perfil/update", authAPI, async (req, res) => {
  const { nome, foto } = req.body;
  const token = req.cookies.token || undefined;

  if (!token) return res.status(401).json({ error: "Usuário sem TOKEN" });

  const UserSchema = z.object({
    nome: z
      .string("Precisa ser um texto")
      .min(1, "Mínimo de 1 caracter")
      .max(24, "Máximo de 24 caracteres")
      .optional(),
    foto: z
      .url("Precisa ser uma URL")
      .refine(async (url) => {
        try {
          const response = await fetch(url, { method: "HEAD" });
          const contentType = response.headers.get("Content-Type");
          return contentType && contentType.startsWith("image/");
        } catch {
          return false;
        }
      }, "Não é uma imagem válida")
      .or(z.literal("SEM_IMAGEM"))
      .optional(),
  });

  const result = await UserSchema.safeParseAsync({
    nome: nome || undefined,
    foto: foto || undefined,
  });

  if (result.error) {
    return res.status(400).json({
      code: "INVALID_FIELD",
      errors: result.error.issues.map((e) => ({
        field: e.path[0],
        error: e.message,
      })),
    });
  } else {
    const data = result.data;
    let campos = [];
    let valores = [];

    if ("nome" in data && data.nome) {
      campos.push("nome = ?");
      valores.push(data.nome);
    }

    if ("foto" in data && data.foto) {
      campos.push("foto = ?");
      if (data.foto === "SEM_IMAGEM") {
        valores.push(null);
      } else {
        valores.push(data.foto);
      }
    }

    if (valores.length <= 0)
      res.status(404).json({ error: "Nenhum campo para modificar" });

    sql = `UPDATE usuarios SET ${campos.join(", ")} WHERE id = ?;`;
    db.run(sql, [...valores, getUserId(token)], (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ error: "ERRO AO ATUALIZAR NO BANCO" });
      }

      return res.status(200).json({ message: "ATUALIZADO COM SUCESSO" });
    });
  }
});

app.post("/auth/register", (req, res) => {
  const { nome, senha } = req.body;

  const UserModel = z.object({
    nome: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(24, "Máximo de 24 caracteres"),
    senha: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(32, "Máximo de 32 caracteres"),
  });

  const result = UserModel.safeParse({ nome, senha });

  if (result.error) {
    return res
      .status(400)
      .json(
        result.error.issues.map((e) => ({ field: e.path[0], error: e.message }))
      );
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
          if (
            err.message ===
            "SQLITE_CONSTRAINT: UNIQUE constraint failed: usuarios.nome"
          ) {
            return res
              .status(409)
              .json({ error: "Já existe um usuário com este nome" });
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
    nome: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(24, "Máximo de 24 caracteres"),
    senha: z
      .string("Precisa ser um texto")
      .min(1, "Não pode ser vazio")
      .max(32, "Máximo de 32 caracteres"),
  });

  const result = UserModel.safeParse({ nome, senha });

  if (result.error) {
    return res
      .status(400)
      .json(
        result.error.issues.map((e) => ({ field: e.path[0], error: e.message }))
      );
  }

  sql = "SELECT id, senha FROM usuarios WHERE nome = ? COLLATE BINARY;";
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
        const decoded = jwt.verify(token, secret);
        res.cookie("token", token, {
          httpOnly: true,
          secure: false,
          sameSite: "lax",
          path: "/",
          maxAge: (decoded.exp - decoded.iat) * 1000,
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

app.get("/auth/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  return res.redirect("/login");
});

// FRONT

let page;
const layout = fs.readFileSync("src/layout.html", "utf-8");

app.get("/", authToken, (req, res) => {
  page = layout.replace(
    "{{NAVBAR}}",
    fs.readFileSync("src/components/navbar.html")
  );
  page = page.replace(
    "{{CONTENT}}",
    fs.readFileSync("src/components/index.html")
  );
  res.send(page);
});

app.get("/admin", authTokenAdmin, (req, res) => {
  page = layout.replace(
    "{{NAVBAR}}",
    fs.readFileSync("src/components/navbar.html")
  );
  page = page.replace(
    "{{CONTENT}}",
    fs.readFileSync("src/components/admin.html")
  );
  res.send(page);
});

app.get("/register", nonAuth, (req, res) => {
  page = layout.replace("{{NAVBAR}}", "");
  page = page.replace(
    "{{CONTENT}}",
    fs.readFileSync("src/components/register.html")
  );
  res.send(page);
});

app.get("/login", nonAuth, (req, res) => {
  page = layout.replace("{{NAVBAR}}", "");
  page = page.replace(
    "{{CONTENT}}",
    fs.readFileSync("src/components/login.html")
  );
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

  sql = `
    SELECT 
    u.nome, 
    u.foto, 
    COUNT(t.id) as total_task, 
    SUM(t.finalizado) as total_finalizado
    FROM usuarios u 
    LEFT JOIN tarefas t ON t.id_usuario = u.id 
    WHERE u.nome = ?;
  `;
  db.all(sql, [nome], (err, data) => {
    if (err) return res.redirect("/");
    if (data.length <= 0) return res.redirect("/");

    user = {
      nome: data[0].nome,
      foto: data[0].foto,
      total_task: data[0].total_task || 0,
      total_finalizado: data[0].total_finalizado || 0,
    };
    page = layout.replace(
      "{{NAVBAR}}",
      fs.readFileSync("src/components/navbar.html")
    );
    page = page.replace(
      "{{CONTENT}}",
      fs.readFileSync("src/components/perfil.html")
    );
    page = page.replace('"USER_STRING"', `'${JSON.stringify(user)}'`);
    res.send(page);
  });
});

app.use(authToken, (req, res) => {
  page = layout.replace(
    "{{NAVBAR}}",
    fs.readFileSync("src/components/navbar.html")
  );
  page = page.replace(
    "{{CONTENT}}",
    fs.readFileSync("src/components/notfound.html")
  );
  res.send(page);
});

// SERVER

app.listen(port, () => {
  let ip;
  var interfaces = networkInterfaces();
  for (var devName in interfaces) {
    var iface = interfaces[devName];

    for (var i = 0; i < iface.length; i++) {
      var alias = iface[i];
      if (
        alias.family === "IPv4" &&
        alias.address !== "127.0.0.1" &&
        !alias.internal
      )
        ip = alias.address;
    }
  }
  console.log(
    `Aplicação inciada!\nRodando na porta ${port}.\nURL local: http://localhost:${port}\nURL na rede: http://${ip}:${port}`
  );
});
