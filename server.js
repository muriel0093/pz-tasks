const { error } = require("console");
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");

const port = 2469;
const app = express();
let sql;

const secret = "uj1SQDFwAI9EWt1CxWpmJHd1XgJbytIB";
const expiresIn = "30d";

app.use(express.static(__dirname));
app.use(express.json());
app.use(cors());
app.use(cookieParser());

const db = new sqlite3.Database("./rats.db", sqlite3.OPEN_READWRITE, (err) => {
  if (err) return console.log(err.message);
});

//

//sql = "INSERT INTO tarefas(codigo, titulo, descricao) VALUES (200258, 'Bloquear classes', 'bloquear as classes na cielo garcom')"
//sql = "SELECT * FROM tarefas"

/* db.all(sql, [], (err, res)=> {
    if(err) return console.log(err)

    res.forEach(res=> {
        console.log(res)
    })
}) */

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

app.get("/teste/:teste", (req, res) => {
  res.json(req.params.teste);
});

app.post("/PostTasks", (req, res) => {
  const { codigo, title, description } = req.body;

  if (!codigo || !title || !description) {
    return res.status(400).json({ error: "Todos os campos sao necessarios" });
  }

  sql = "INSERT INTO tarefas(codigo, titulo, descricao) VALUES (?,?,?);";
  db.run(sql, [codigo, title, description], (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ error: "ERRO AO INSERIR NO BANCO" });
    }

    return res.status(200).json({ message: "INSERIDO COM SUCESSO" });
  });
});

app.get("/GetTasks", (req, res) => {
  sql = "SELECT * FROM tarefas";
  db.all(sql, [], (err, rows) => {
    if (err) return "NO DATA";

    res.status(200).json({ rows });
  });
});

app.post("/auth/register", (req, res) => {
  const { nome, senha } = req.body;

  if (!nome || !senha) {
    return res
      .status(400)
      .json({ error: "Todos os campos sao necessarios { nome, senha }" });
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

      sql = "INSERT INTO usuarios(nome, senha) VALUES (?, ?);";
      db.run(sql, [nome, hash], (err) => {
        if (err) {
          console.log(err);
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

  if (!nome || !senha) {
    return res
      .status(400)
      .json({ error: "Todos os campos sao necessarios { nome, senha }" });
  }

  sql = "SELECT nome, senha FROM usuarios WHERE nome = ?;";
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
    // req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.redirect("/login");
  }
}

const layout = fs.readFileSync("layout.html", "utf-8");

app.get("/", authToken, (req, res) => {
  res.send(layout.replace("{{CONTENT}}", fs.readFileSync("rats.html")));
});

app.get("/login", (req, res) => {
  res.send(layout.replace("{{CONTENT}}", fs.readFileSync("login.html")));
});

app.get("/cadastro", authToken, (req, res) => {
  res.send(layout.replace("{{CONTENT}}", fs.readFileSync("cadastro.html")));
});

app.listen(port, () => {
  console.log("Server Start");
});