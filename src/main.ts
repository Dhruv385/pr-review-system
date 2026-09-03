import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

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
        .setDescription('GitHub and GitLab Pull Request Review Management API')
        .setVersion('1.0.0')
        .addBearerAuth()
        .addTag('Accounts', 'OAuth authentication and account management')
        .addTag('Pull Requests', 'Pull request retrieval and management')
        .addTag('Reviews', 'Code review retrieval and management')
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
