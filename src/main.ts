import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

    // Consistent, safe error shape for every response + structured per-request
    // logging (requestId, userId, method, path, statusCode, durationMs).
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());

    const configuredOrigins = (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);

    app.enableCors({
        origin: (requestOrigin, callback) => {
            const isLocalDevelopmentOrigin = process.env.NODE_ENV !== 'production'
                && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(requestOrigin ?? '');
            const isConfiguredOrigin = requestOrigin !== undefined
                && configuredOrigins.includes(requestOrigin);

            callback(null, !requestOrigin || isLocalDevelopmentOrigin || isConfiguredOrigin);
        },
        methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
        allowedHeaders: 'Content-Type,Authorization,Accept',
        credentials: true,
    });

    // Swagger configuration
    const config = new DocumentBuilder()
        .setTitle('PR Review System API')
        .setDescription(
            'GitHub and GitLab Pull Request review management, with AI-assisted code review.\n\n' +
            '**Typical flow:** `POST /auth/register` (or `/auth/login`) → copy the returned ' +
            '`accessToken` into the Authorize button below → `GET /accounts/{provider}/connect` to ' +
            'get an OAuth URL, open it in a browser to link your account → `GET /pull-requests` to ' +
            'sync and list your PRs.\n\n' +
            'Every error response follows the same shape: `{ statusCode, error, message, timestamp, path }`.',
        )
        .setVersion('1.0.0')
        .addBearerAuth()
        .addTag('Authentication', 'Register, log in, and verify access tokens')
        .addTag('Accounts', 'OAuth account linking for GitHub and GitLab')
        .addTag('Pull Requests', 'Pull request retrieval, sync, and AI-assisted review')
        .addTag('Reviews', 'Code review retrieval')
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
        swaggerOptions: {
            persistAuthorization: true,
        },
    });

    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    console.log(`Application running on port ${port}`);
    console.log(`Swagger documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();
