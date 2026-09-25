import fastify from "fastify";
import fastifyFormbody from '@fastify/formbody'

let AUTH_ID: string; // variável para salvar o token em memória

const app = fastify();

app.register(fastifyFormbody)

// Rota de instalação (recebe token e salve na variável AUTH_ID)
app.post<{Body: {AUTH_ID: string}}>("/local-app", async (req) => {
    
    AUTH_ID = req.body.AUTH_ID

    console.log(req.body)

    return {appInfo: req.body};
});

// Rota para buscar dados do usuário logado (utiliza o token recebido na instalação para realizar requisição)
app.post("/user", async () => {
    const response = await fetch(`https://tiqtech.bitrix24.com.br/rest/user.current?auth=${AUTH_ID}`);

    const userInfo = await response.json();

    return {
        user: userInfo.result,
    }
});

app.post("/list-deals", async (req) => {
    const response = await fetch(`https://tiqtech.bitrix24.com.br/rest/crm.deal.list?auth=${AUTH_ID}`);

    const deals = await response.json();

    console.log(req.body)
    console.log(deals);

    return {
        deals: deals.result,
    };
});

app.listen({
    host: "0.0.0.0",
    port: 3333
}).then(() => {
    console.log("HTTP Server Running");
});