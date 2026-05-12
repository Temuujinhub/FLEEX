import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LiveGateway } from './live.gateway';

// LiveGateway verifies the JWT presented during the WS upgrade, so it
// needs its own JwtModule wired up — auth.module's instance isn't visible
// here even though both register the same secret.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [LiveGateway],
})
export class WebsocketModule {}
