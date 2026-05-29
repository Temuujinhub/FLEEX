import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LiveGateway } from './live.gateway';
import { assertStrongJwtSecret } from '../auth/jwt-secret.util';

// LiveGateway verifies the JWT presented during the WS upgrade, so it
// needs its own JwtModule wired up — auth.module's instance isn't visible
// here even though both register the same secret.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: assertStrongJwtSecret(cfg.get<string>('JWT_SECRET')),
        signOptions: { algorithm: 'HS256' as const },
      }),
    }),
  ],
  providers: [LiveGateway],
})
export class WebsocketModule {}
