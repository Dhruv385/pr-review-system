import { NestFactory } from '@nestjs/core';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './filter/all-exceptions.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';
import { EnvService } from '@shared/env';
import { AppLogger } from '@shared/logger';

/**
 * @description Handles initialization of the server: pipes/CORS in the
 * constructor, filters/interceptors/Swagger in their own setup methods.
 */
class Server {
    static async bootstrap(): Promise<Server> {
        const app = await NestFactory.create(AppModule);
        app.enableShutdownHooks();

        const server = new Server(app);
        server.setupSwagger();
        return server;
    }

    readonly #env: EnvService;
    readonly #logger: AppLogger;

    constructor(public app: INestApplication) {
        this.#env = app.get(EnvService);
        this.#logger = app.get(AppLogger);

        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

        const configuredOrigins = this.#env.CORS_ORIGINS
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean);

        app.enableCors({
            origin: (requestOrigin, callback) => {
                const isLocalDevelopmentOrigin = !this.#env.IS_PRODUCTION
                    && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin ?? '');
                const isConfiguredOrigin = requestOrigin !== undefined
                    && configuredOrigins.includes(requestOrigin);

                callback(null, !requestOrigin || isLocalDevelopmentOrigin || isConfiguredOrigin);
            },
            methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
            allowedHeaders: 'Content-Type,Authorization,Accept',
            credentials: true,
        });

        this.setupFilters();
        this.setupInterceptors();
    }

    setupFilters() {
        this.app.useGlobalFilters(new AllExceptionsFilter());
    }

    setupInterceptors() {
        this.app.useGlobalInterceptors(new LoggingInterceptor());
    }

    setupSwagger() {
        const config = new DocumentBuilder()
            .setTitle('PR Review System API')
            .setDescription(
                'GitHub and GitLab Pull Request review management, with AI-assisted code review.\n\n' +
                '**Typical flow:** authorize below with the shared **Basic Auth** client credential, then ' +
                '`POST /auth/register` (or `/auth/login`) → copy the returned `accessToken` into the ' +
                '**Bearer** Authorize field → `GET /accounts/{provider}/connect` to get an OAuth URL, open ' +
                'it in a browser to link your account → `GET /pull-requests` to sync and list your PRs.\n\n' +
                '`/auth/register` and `/auth/login` require both: the shared Basic Auth client credential ' +
                '(gates anonymous bots off the signup surface) and their own request body — Basic Auth is ' +
                'not a substitute for the per-user JWT those endpoints issue on success.\n\n' +
                'Every error response follows the same shape: `{ statusCode, error, message, timestamp, path }`.',
            )
            .setVersion('1.0.0')
            .addBearerAuth()
            .addBasicAuth({ type: 'http', scheme: 'basic', description: 'Shared client credential required on /auth/register and /auth/login' })
            .addTag('Authentication', 'Register, log in, and verify access tokens')
            .addTag('Accounts', 'OAuth account linking for GitHub and GitLab')
            .addTag('Pull Requests', 'Pull request retrieval, sync, and AI-assisted review')
            .addTag('Reviews', 'Code review retrieval')
            .build();

        const document = SwaggerModule.createDocument(this.app, config);
        SwaggerModule.setup('api/docs', this.app, document, {
            swaggerOptions: {
                persistAuthorization: true,
            },
        });
    }

    async start() {
        try {
            const port = this.#env.PORT;
            await this.app.listen(port);
            this.#logger.log(`Application running on: ${await this.app.getUrl()}`);
            this.#logger.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
        } catch (err) {
            const error = err as Error;
            this.#logger.error(error.message, error.stack);
        }
    }
}

Server.bootstrap()
    .then(async (server) => {
        await server.start();
    })
    .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Failed to bootstrap application', err);
        process.exit(1);
    });
